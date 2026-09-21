/**
 * Deterministic risk + financial engine.
 *
 * Kept intentionally free of any LLM call: severity and dollar amounts must be
 * reproducible and auditable (spec §22, §29, §60). The AI layer (extraction.ts)
 * only supplies structured *inputs* to this engine — it never computes the
 * score or the money itself.
 */

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface RiskFactors {
  probability: number; // 0-100
  impact: number; // 0-100
  urgency: number; // 0-100
}

export interface FinancialSignals {
  affectedHours?: number | null;
  materialQuantity?: number | null;
  materialUnit?: string | null;
  knownUnitCost?: number | null;
  statedDollarAmount?: number | null;
}

export interface FinancialAssumptions {
  loadedLaborRate: number;
  typicalCrewSize: number;
  dailyOverhead: number;
  defaultMarkup: number;
  materialMarkup: number;
}

export interface ExposureResult {
  category: "REVENUE_OPPORTUNITY" | "COST_EXPOSURE" | "SCHEDULE_EXPOSURE";
  lowAmount: number | null;
  highAmount: number | null;
  hasAmount: boolean;
  calculationMethod: string;
}

const REVENUE_TYPES = new Set(["SCOPE_CHANGE", "EXTRA_WORK", "UNPRICED_WORK", "CUSTOMER_REQUEST"]);
const SCHEDULE_TYPES = new Set([
  "MATERIAL_DELAY", "MATERIAL_SHORTAGE", "CREW_DELAY", "CREW_IDLE", "TRADE_DELAY",
  "DEPENDENCY_BLOCKED", "SCHEDULE_RISK", "MILESTONE_RISK", "COMPLETION_RISK",
]);

/** Severity bands per spec §22. Geometric mean keeps the 0-100 scale meaningful
 *  (a naive product of three 0-100 numbers collapses toward zero). */
export function computeSeverity(factors: RiskFactors): { score: number; band: Severity } {
  const p = Math.max(1, factors.probability);
  const i = Math.max(1, factors.impact);
  const u = Math.max(1, factors.urgency);
  const score = Math.round(Math.cbrt(p * i * u));
  let band: Severity = "LOW";
  if (score >= 80) band = "CRITICAL";
  else if (score >= 60) band = "HIGH";
  else if (score >= 35) band = "MEDIUM";
  return { score, band };
}

/** Financial exposure. Never invents a number — returns hasAmount:false and an
 *  explanatory method string when the source didn't supply enough to calculate
 *  (spec §29, the absolute "no invented numbers" rule). */
export function computeExposure(
  eventType: string,
  confidence: number,
  fin: FinancialSignals,
  assumptions: FinancialAssumptions
): ExposureResult {
  const uncertainty = 0.15 + (1 - confidence) * 0.35;
  let base: number | null = null;
  let method = "";

  if (fin.statedDollarAmount) {
    base = fin.statedDollarAmount;
    method = "Amount stated directly in source.";
  } else if (fin.materialQuantity && fin.knownUnitCost) {
    base = fin.materialQuantity * fin.knownUnitCost * (1 + assumptions.materialMarkup);
    method = `${fin.materialQuantity} ${fin.materialUnit ?? "units"} x $${fin.knownUnitCost}/unit + material markup.`;
  } else if (fin.affectedHours) {
    base = fin.affectedHours * assumptions.loadedLaborRate;
    method = `${fin.affectedHours} affected hours x $${assumptions.loadedLaborRate}/hr loaded labor rate.`;
  }

  const category = REVENUE_TYPES.has(eventType)
    ? "REVENUE_OPPORTUNITY"
    : SCHEDULE_TYPES.has(eventType)
      ? "SCHEDULE_EXPOSURE"
      : "COST_EXPOSURE";

  if (base == null) {
    return { category, lowAmount: null, highAmount: null, hasAmount: false, calculationMethod: "Insufficient information to estimate value." };
  }
  return {
    category,
    lowAmount: Math.max(0, Math.round(base * (1 - uncertainty))),
    highAmount: Math.round(base * (1 + uncertainty)),
    hasAmount: true,
    calculationMethod: method,
  };
}

export interface AlertGateInput {
  confidence: number;
  severity: Severity;
  hasAmount: boolean;
}

/** Alert generation gate (spec §26): don't let every event become an alert.
 *  Returns false for low-confidence or trivial-impact events. Duplicate
 *  suppression (same project+type+title still open) is a DB query, done by
 *  the caller before persisting — not this pure function's job. */
export function passesAlertGate(input: AlertGateInput): boolean {
  if (input.confidence < 0.4) return false;
  if (input.severity === "LOW" && !input.hasAmount) return false;
  return true;
}

/** Double-counting protection (spec §33): events cascaded from the same raw
 *  input (same chainId) are one underlying economic event — take the largest
 *  single exposure in the chain for the "unique" total rather than summing
 *  every downstream effect. Standalone events sum normally. */
export function uniqueExposureTotal(
  exposures: { chainId: string | null; highAmount: number | null }[]
): number {
  const chains = new Map<string, number[]>();
  let standalone = 0;
  for (const exp of exposures) {
    if (exp.highAmount == null) continue;
    if (exp.chainId) {
      const list = chains.get(exp.chainId) ?? [];
      list.push(exp.highAmount);
      chains.set(exp.chainId, list);
    } else {
      standalone += exp.highAmount;
    }
  }
  let chainTotal = 0;
  for (const list of chains.values()) chainTotal += Math.max(...list);
  return standalone + chainTotal;
}

/** Project identification (spec §10): only auto-assigns on a clear, unambiguous
 *  match. Ties or zero matches return null — the caller must ask, never guess. */
export function guessProjectId(
  text: string,
  projects: { id: string; name: string; clientName?: string | null; address?: string | null }[]
): { projectId: string | null; confident: boolean } {
  if (!text || projects.length === 0) return { projectId: null, confident: false };
  if (projects.length === 1) return { projectId: projects[0].id, confident: true };
  const t = text.toLowerCase();
  const scored = projects
    .map((p) => {
      const words = `${p.name} ${p.clientName ?? ""} ${p.address ?? ""}`
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2);
      const score = words.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0);
      return { id: p.id, score };
    })
    .sort((a, b) => b.score - a.score);
  if (scored[0].score === 0) return { projectId: null, confident: false };
  if (scored.length > 1 && scored[0].score === scored[1].score) return { projectId: null, confident: false };
  return { projectId: scored[0].id, confident: true };
}

/** R010 — unacknowledged critical event (spec §21). An alert sitting OPEN past
 *  a configurable age threshold gets flagged for escalation, even though
 *  nothing new has happened — the passage of time itself is the signal.
 *  Acknowledging/actioning it counts as "management knows" and clears the
 *  flag regardless of age. Ported from the prototype (jobsite-intelligence.html),
 *  where it was verified against the spec's acceptance tests. */
const AGING_THRESHOLDS_MS: Partial<Record<Severity, number>> = {
  CRITICAL: 24 * 3600 * 1000,
  HIGH: 72 * 3600 * 1000,
};

export interface AgingAlertInput {
  id: string;
  severity: Severity;
  status: string;
  createdAt: Date;
}

export interface AgingAlertResult {
  alertId: string;
  ageHours: number;
  reason: string;
}

export function detectAgingAlerts(alerts: AgingAlertInput[], now: Date = new Date()): AgingAlertResult[] {
  return alerts
    .filter((a) => a.status === "OPEN")
    .filter((a) => AGING_THRESHOLDS_MS[a.severity] != null)
    .filter((a) => now.getTime() - a.createdAt.getTime() > AGING_THRESHOLDS_MS[a.severity]!)
    .map((a) => {
      const ageHours = Math.round((now.getTime() - a.createdAt.getTime()) / 3600000);
      return { alertId: a.id, ageHours, reason: `${a.severity} alert has been open for ${ageHours}h without acknowledgement.` };
    });
}

/** R009 / "management doesn't know" detector (spec §9, §49). No single update
 *  looks urgent, but 3+ weak signals about the same topic on the same project
 *  collectively indicate a real risk nobody has escalated.
 *
 *  Matches primarily on extracted entities (structured, reliable), falling
 *  back to keyword overlap with length>=4 minus a stopword list. NOTE: the
 *  prototype's first version filtered words to length>4, which silently
 *  dropped 4-letter words like "tile" and "crew" — exactly the terms that
 *  connect the spec's own canonical example — so it never fired. Caught by
 *  the acceptance test suite and fixed there; ported here already correct. */
const SILENT_RISK_STOPWORDS = new Set([
  "this", "that", "from", "been", "have", "still", "again", "today", "after",
  "need", "needs", "into", "with", "they", "them", "were", "being", "once", "more", "than", "also",
]);
const NON_ESCALATABLE_SEVERITIES = new Set<Severity>(["HIGH", "CRITICAL"]);

export interface SilentRiskEventInput {
  id: string;
  title: string;
  description: string;
  entities: string[];
  severity: Severity;
}

export interface SilentRiskResult {
  involvedEventIds: string[];
  involvedCount: number;
}

export function detectSilentRisk(recentProjectEvents: SilentRiskEventInput[], newEvent: SilentRiskEventInput): SilentRiskResult | null {
  const newEntities = new Set(newEvent.entities.map((e) => e.toLowerCase()));
  const words = `${newEvent.title} ${newEvent.description}`
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 4 && !SILENT_RISK_STOPWORDS.has(w));

  const related = recentProjectEvents.filter((e) => {
    if (e.id === newEvent.id) return false;
    const eEntities = e.entities.map((x) => x.toLowerCase());
    if (eEntities.some((x) => newEntities.has(x))) return true;
    const text = `${e.title} ${e.description}`.toLowerCase();
    return words.some((w) => text.includes(w));
  });

  if (related.length < 2) return null; // need this event + 2 prior = 3 total weak signals

  const all = [newEvent, ...related];
  // If any involved event was already HIGH/CRITICAL on its own, this isn't a
  // "silent" pattern — it already would have been surfaced individually.
  if (all.some((e) => NON_ESCALATABLE_SEVERITIES.has(e.severity))) return null;

  return { involvedEventIds: all.map((e) => e.id), involvedCount: all.length };
}
