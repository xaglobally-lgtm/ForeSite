import { prisma } from "./db";
import { extractEvents } from "./extraction";
import { computeSeverity, computeExposure, passesAlertGate, detectSilentRisk, FinancialAssumptions } from "./risk-engine";
import { notifyAlert } from "./notifications";
import { track } from "./analytics";
import { getObjectBase64 } from "./storage";

/**
 * Full pipeline: RawInput -> Events -> Exposures -> Alerts (+ recurring-pattern
 * and silent-risk detection, + notifications). One function, one transaction
 * per raw input. Mirrors processRawInput() in the prototype, backed by real
 * persistence — same detection logic, verified against the same acceptance
 * tests (see risk-engine.test.ts for the ported R008/R009/R010 tests).
 */
export async function processRawInput(rawInputId: string) {
  const rawInput = await prisma.rawInput.update({
    where: { id: rawInputId },
    data: { processingStatus: "PROCESSING" },
  });

  const assumptionsRow = await prisma.financialAssumption.findUnique({ where: { companyId: rawInput.companyId } });
  const assumptions: FinancialAssumptions = assumptionsRow
    ? {
        loadedLaborRate: assumptionsRow.loadedLaborRate,
        typicalCrewSize: assumptionsRow.typicalCrewSize,
        dailyOverhead: assumptionsRow.dailyOverhead,
        defaultMarkup: assumptionsRow.defaultMarkup,
        materialMarkup: assumptionsRow.materialMarkup,
      }
    : { loadedLaborRate: 65, typicalCrewSize: 4, dailyOverhead: 400, defaultMarkup: 0.18, materialMarkup: 0.12 };

  let extracted;
  try {
    extracted = await extractEvents(
      rawInput.type === "PHOTO"
        ? { kind: "image", mediaType: rawInput.fileMediaType ?? "image/jpeg", base64: await getObjectBase64(rawInput.fileUrl!) }
        : rawInput.type === "PDF"
          ? { kind: "pdf", base64: await getObjectBase64(rawInput.fileUrl!) }
          : { kind: "text", text: rawInput.contentText ?? "" }
    );
  } catch (err) {
    await prisma.rawInput.update({ where: { id: rawInputId }, data: { processingStatus: "FAILED" } });
    throw err;
  }

  const createdAlertIds: string[] = [];
  const batchEventIds: string[] = [];
  let prevEventId: string | null = null;

  for (const raw of extracted) {
    const { score, band } = computeSeverity(raw.risk_factors);
    const exposure = computeExposure(raw.type, raw.confidence, {
      affectedHours: raw.financial_signals.affected_hours,
      materialQuantity: raw.financial_signals.material_quantity,
      materialUnit: raw.financial_signals.material_unit,
      knownUnitCost: raw.financial_signals.known_unit_cost,
      statedDollarAmount: raw.financial_signals.stated_dollar_amount,
    }, assumptions);

    const event = await prisma.event.create({
      data: {
        companyId: rawInput.companyId,
        projectId: rawInput.projectId!,
        sourceId: rawInput.id,
        chainId: rawInput.id,
        type: raw.type,
        title: raw.title,
        description: raw.description,
        confidence: raw.confidence,
        fact: raw.fact,
        signal: raw.signal,
        inference: raw.inference,
        recommendation: raw.recommendation,
        entities: raw.entities ?? [],
        affectedHours: raw.financial_signals.affected_hours,
        materialQuantity: raw.financial_signals.material_quantity,
        materialUnit: raw.financial_signals.material_unit,
        knownUnitCost: raw.financial_signals.known_unit_cost,
        statedDollarAmount: raw.financial_signals.stated_dollar_amount,
        probability: raw.risk_factors.probability,
        impact: raw.risk_factors.impact,
        urgency: raw.risk_factors.urgency,
        severityScore: score,
        severity: band,
      },
    });
    batchEventIds.push(event.id);

    if (prevEventId) {
      await prisma.eventRelationship.create({
        data: { fromId: prevEventId, toId: event.id, type: "MAY_CAUSE" },
      });
    }
    prevEventId = event.id;

    const exposureRow = await prisma.exposure.create({
      data: {
        projectId: rawInput.projectId!,
        sourceEventId: event.id,
        category: exposure.category,
        lowAmount: exposure.lowAmount,
        highAmount: exposure.highAmount,
        confidence: raw.confidence,
        calculationMethod: exposure.calculationMethod,
        assumptionsSnapshot: assumptions as any,
        hasAmount: exposure.hasAmount,
      },
    });

    await createAlertIfWarranted(rawInput.companyId, event.id, raw.confidence, band, {
      projectId: rawInput.projectId!, exposureId: exposureRow.id, hasAmount: exposure.hasAmount,
      title: raw.title, summary: raw.description,
      whyItMatters: raw.inference ?? raw.signal ?? "May affect project cost, schedule, or documentation.",
      recommendedAction: raw.recommendation ?? "Review and confirm details with the field.",
      eventType: raw.type,
    }, createdAlertIds);
  }

  await prisma.rawInput.update({ where: { id: rawInputId }, data: { processingStatus: "DONE" } });

  createdAlertIds.push(...(await detectRecurringPatterns(rawInput.companyId, rawInput.projectId!, assumptions)));
  createdAlertIds.push(...(await runSilentRiskDetection(rawInput.companyId, rawInput.projectId!, batchEventIds, assumptions)));

  return createdAlertIds;
}

/** Shared alert-creation path so every detector (per-event, recurring, silent-risk)
 *  applies the same gate, the same dedup rule, and fires the same notification. */
async function createAlertIfWarranted(
  companyId: string,
  eventId: string,
  confidence: number,
  severity: ReturnType<typeof computeSeverity>["band"],
  info: { projectId: string; exposureId: string; hasAmount: boolean; title: string; summary: string; whyItMatters: string; recommendedAction: string; eventType: string },
  createdAlertIds: string[]
) {
  track("event_created", { companyId, projectId: info.projectId, eventType: info.eventType, severity });

  if (!passesAlertGate({ confidence, severity, hasAmount: info.hasAmount })) return;

  const dup = await prisma.alert.findFirst({
    where: { projectId: info.projectId, title: info.title, status: { not: "DISMISSED" }, event: { type: info.eventType as any } },
  });
  if (dup) return;

  const alert = await prisma.alert.create({
    data: {
      projectId: info.projectId, eventId, exposureId: info.exposureId, severity,
      title: info.title, summary: info.summary, whyItMatters: info.whyItMatters,
      recommendedAction: info.recommendedAction, confidence,
    },
  });
  createdAlertIds.push(alert.id);
  track("alert_created", { companyId, projectId: info.projectId, severity, alertId: alert.id });
  await notifyAlert({ id: alert.id, projectId: info.projectId, severity, title: info.title, summary: info.summary });
}

/** R008 — recurring problem engine (spec §50). 3+ events on the same project
 *  sharing an entity (subcontractor, material, trade) => one RECURRING_PROBLEM
 *  event+alert, using neutral language, never automatic blame. */
async function detectRecurringPatterns(companyId: string, projectId: string, assumptions: FinancialAssumptions): Promise<string[]> {
  const events = await prisma.event.findMany({ where: { projectId, type: { not: "RECURRING_PROBLEM" } } });
  const byEntity = new Map<string, typeof events>();
  for (const e of events) {
    for (const ent of e.entities) {
      const key = ent.toLowerCase();
      const list = byEntity.get(key) ?? [];
      list.push(e);
      byEntity.set(key, list);
    }
  }

  const createdAlertIds: string[] = [];
  for (const [entity, evs] of byEntity) {
    if (evs.length < 3) continue;
    const already = await prisma.event.findFirst({
      where: { projectId, type: "RECURRING_PROBLEM", entities: { has: entity } },
    });
    if (already) continue;

    const { score, band } = computeSeverity({ probability: 70, impact: 55, urgency: 45 });
    const event = await prisma.event.create({
      data: {
        companyId, projectId, sourceId: null, chainId: null, type: "RECURRING_PROBLEM",
        title: `Recurring issue pattern: ${entity}`,
        description: `${evs.length} separate issues linked to "${entity}" have been logged on this project.`,
        confidence: 0.7,
        fact: `${evs.length} logged events reference "${entity}".`,
        signal: "The same entity keeps generating issues rather than this being a one-off.",
        inference: "This is likely a systemic pattern rather than isolated incidents.",
        recommendation: `Review recent work involving "${entity}" directly with the site lead.`,
        entities: [entity],
        probability: 70, impact: 55, urgency: 45, severityScore: score, severity: band,
      },
    });
    const exposure = computeExposure("RECURRING_PROBLEM", 0.7, {}, assumptions);
    const exposureRow = await prisma.exposure.create({
      data: {
        projectId, sourceEventId: event.id, category: exposure.category,
        lowAmount: exposure.lowAmount, highAmount: exposure.highAmount, confidence: 0.7,
        calculationMethod: exposure.calculationMethod, hasAmount: exposure.hasAmount,
      },
    });
    await createAlertIfWarranted(companyId, event.id, 0.7, band, {
      projectId, exposureId: exposureRow.id, hasAmount: exposure.hasAmount,
      title: event.title, summary: event.description, whyItMatters: event.inference!,
      recommendedAction: event.recommendation!, eventType: "RECURRING_PROBLEM",
    }, createdAlertIds);
  }
  return createdAlertIds;
}

/** R009 / "management doesn't know" detector (spec §9, §49). Runs the pure
 *  detectSilentRisk() from risk-engine.ts against this project's recent event
 *  history for each event just created in this batch. See risk-engine.ts for
 *  why entity-based matching matters here (a length>4 keyword filter used to
 *  silently drop "tile"/"crew" and never fire on the spec's own example). */
async function runSilentRiskDetection(companyId: string, projectId: string, newBatchEventIds: string[], assumptions: FinancialAssumptions): Promise<string[]> {
  const recent = await prisma.event.findMany({
    where: { projectId, type: { not: "RECURRING_PROBLEM" }, chainId: { not: null } },
    orderBy: { occurredAt: "desc" },
    take: 25,
  });
  const newEvents = recent.filter((e) => newBatchEventIds.includes(e.id));

  const createdAlertIds: string[] = [];
  for (const evt of newEvents) {
    const result = detectSilentRisk(
      recent.map((e) => ({ id: e.id, title: e.title, description: e.description, entities: e.entities, severity: e.severity })),
      { id: evt.id, title: evt.title, description: evt.description, entities: evt.entities, severity: evt.severity }
    );
    if (!result) continue;

    const alreadyEscalated = await prisma.event.findFirst({
      where: { projectId, title: { startsWith: "Management attention required" }, description: { contains: evt.title } },
    });
    if (alreadyEscalated) continue;

    const { score, band } = computeSeverity({ probability: 75, impact: 55, urgency: 60 });
    const escEvent = await prisma.event.create({
      data: {
        companyId, projectId, sourceId: null, chainId: null, type: "SCHEDULE_RISK",
        title: `Management attention required: ${evt.title}`,
        description: `${result.involvedCount} separate field updates about this have come in without individually triggering a high-priority alert. Together they suggest a real problem.`,
        confidence: 0.72,
        fact: `${result.involvedCount} related field updates logged.`,
        signal: "No single update read as urgent on its own.",
        inference: "Taken together, this pattern suggests the issue is worse than any one update implied — and may not have reached management yet.",
        recommendation: "Review the full thread of related updates and confirm the underlying issue is being actively managed.",
        entities: [],
        probability: 75, impact: 55, urgency: 60, severityScore: score, severity: band,
      },
    });
    const exposure = computeExposure("SCHEDULE_RISK", 0.72, {}, assumptions);
    const exposureRow = await prisma.exposure.create({
      data: {
        projectId, sourceEventId: escEvent.id, category: exposure.category,
        lowAmount: exposure.lowAmount, highAmount: exposure.highAmount, confidence: 0.72,
        calculationMethod: exposure.calculationMethod, hasAmount: exposure.hasAmount,
      },
    });
    await createAlertIfWarranted(companyId, escEvent.id, 0.72, band, {
      projectId, exposureId: exposureRow.id, hasAmount: exposure.hasAmount,
      title: escEvent.title, summary: escEvent.description, whyItMatters: escEvent.inference!,
      recommendedAction: escEvent.recommendation!, eventType: "SCHEDULE_RISK",
    }, createdAlertIds);
  }
  return createdAlertIds;
}
