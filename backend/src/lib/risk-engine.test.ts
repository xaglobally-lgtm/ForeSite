import { describe, it, expect } from "vitest";
import { computeSeverity, computeExposure, passesAlertGate, uniqueExposureTotal, guessProjectId, detectAgingAlerts, detectSilentRisk } from "./risk-engine";

const assumptions = { loadedLaborRate: 65, typicalCrewSize: 4, dailyOverhead: 400, defaultMarkup: 0.18, materialMarkup: 0.12 };

describe("computeSeverity", () => {
  it("bands scores per spec §22", () => {
    expect(computeSeverity({ probability: 90, impact: 90, urgency: 90 }).band).toBe("CRITICAL");
    expect(computeSeverity({ probability: 65, impact: 65, urgency: 65 }).band).toBe("HIGH");
    expect(computeSeverity({ probability: 40, impact: 40, urgency: 40 }).band).toBe("MEDIUM");
    expect(computeSeverity({ probability: 10, impact: 10, urgency: 10 }).band).toBe("LOW");
  });
});

describe("computeExposure", () => {
  it("never invents a number when no financial signal is present", () => {
    const result = computeExposure("UNPRICED_WORK", 0.8, {}, assumptions);
    expect(result.hasAmount).toBe(false);
    expect(result.lowAmount).toBeNull();
  });

  it("calculates from affected hours when given", () => {
    const result = computeExposure("CREW_IDLE", 0.8, { affectedHours: 8 }, assumptions);
    expect(result.hasAmount).toBe(true);
    expect(result.lowAmount).toBeGreaterThan(0);
    expect(result.highAmount).toBeGreaterThan(result.lowAmount!);
  });

  it("categorizes revenue vs schedule vs cost types correctly", () => {
    expect(computeExposure("EXTRA_WORK", 0.8, {}, assumptions).category).toBe("REVENUE_OPPORTUNITY");
    expect(computeExposure("MATERIAL_DELAY", 0.8, {}, assumptions).category).toBe("SCHEDULE_EXPOSURE");
    expect(computeExposure("REWORK", 0.8, {}, assumptions).category).toBe("COST_EXPOSURE");
  });
});

describe("passesAlertGate", () => {
  it("suppresses low-confidence events", () => {
    expect(passesAlertGate({ confidence: 0.2, severity: "HIGH", hasAmount: true })).toBe(false);
  });
  it("suppresses trivial LOW events with no dollar exposure", () => {
    expect(passesAlertGate({ confidence: 0.8, severity: "LOW", hasAmount: false })).toBe(false);
  });
  it("allows a confident, meaningful event through", () => {
    expect(passesAlertGate({ confidence: 0.8, severity: "HIGH", hasAmount: true })).toBe(true);
  });
});

describe("uniqueExposureTotal", () => {
  it("collapses a same-chain cascade to its largest single exposure", () => {
    const exposures = [
      { chainId: "input_1", highAmount: 500 },
      { chainId: "input_1", highAmount: 800 },
      { chainId: "input_1", highAmount: 300 },
    ];
    expect(uniqueExposureTotal(exposures)).toBe(800);
  });
  it("sums standalone exposures normally", () => {
    const exposures = [{ chainId: null, highAmount: 100 }, { chainId: null, highAmount: 200 }];
    expect(uniqueExposureTotal(exposures)).toBe(300);
  });
});

describe("guessProjectId", () => {
  const projects = [
    { id: "p1", name: "Miller Residence", clientName: "Miller Family", address: "214 Larkspur Ln" },
    { id: "p2", name: "Jones Remodel", clientName: "Jones, T.", address: "88 Cedar Ct" },
  ];
  it("refuses to guess with no distinguishing match", () => {
    expect(guessProjectId("The cabinets are delayed again.", projects).confident).toBe(false);
  });
  it("matches confidently on a named project", () => {
    const result = guessProjectId("Miller wants the backsplash extended.", projects);
    expect(result).toEqual({ projectId: "p1", confident: true });
  });
});

describe("detectAgingAlerts", () => {
  const now = new Date("2026-09-07T12:00:00Z");
  it("flags a CRITICAL alert open >24h", () => {
    const alerts = [{ id: "a1", severity: "CRITICAL" as const, status: "OPEN", createdAt: new Date("2026-09-06T09:00:00Z") }];
    const result = detectAgingAlerts(alerts, now);
    expect(result.map((r) => r.alertId)).toContain("a1");
  });
  it("does not flag a fresh CRITICAL alert", () => {
    const alerts = [{ id: "a2", severity: "CRITICAL" as const, status: "OPEN", createdAt: new Date("2026-09-07T10:00:00Z") }];
    expect(detectAgingAlerts(alerts, now)).toHaveLength(0);
  });
  it("does not flag an acknowledged alert regardless of age", () => {
    const alerts = [{ id: "a3", severity: "CRITICAL" as const, status: "ACKNOWLEDGED", createdAt: new Date("2026-09-01T00:00:00Z") }];
    expect(detectAgingAlerts(alerts, now)).toHaveLength(0);
  });
  it("flags a HIGH alert open >72h but not <72h", () => {
    const alerts = [
      { id: "a4", severity: "HIGH" as const, status: "OPEN", createdAt: new Date("2026-09-04T00:00:00Z") }, // >72h
      { id: "a5", severity: "HIGH" as const, status: "OPEN", createdAt: new Date("2026-09-06T00:00:00Z") }, // <72h
    ];
    const result = detectAgingAlerts(alerts, now);
    expect(result.map((r) => r.alertId)).toEqual(["a4"]);
  });
  it("never flags MEDIUM/LOW severities (no threshold defined)", () => {
    const alerts = [{ id: "a6", severity: "MEDIUM" as const, status: "OPEN", createdAt: new Date("2026-01-01T00:00:00Z") }];
    expect(detectAgingAlerts(alerts, now)).toHaveLength(0);
  });
});

describe("detectSilentRisk", () => {
  it("does not escalate with fewer than 3 related weak signals", () => {
    const prior = [{ id: "e1", title: "Still waiting on tile", description: "Tile has not arrived yet.", entities: ["tile"], severity: "LOW" as const }];
    const newEvent = { id: "e2", title: "Need to reschedule tile crew", description: "Tile crew needs to be rescheduled.", entities: ["tile crew"], severity: "MEDIUM" as const };
    expect(detectSilentRisk(prior, newEvent)).toBeNull();
  });

  it("escalates the spec's canonical tile example (4 weak signals via shared entities)", () => {
    const prior = [
      { id: "d1", title: "Still waiting on tile", description: "Tile has not arrived yet.", entities: ["tile"], severity: "LOW" as const },
      { id: "d2", title: "Tile hasn't arrived", description: "Tile delivery is now late.", entities: ["tile"], severity: "LOW" as const },
      { id: "d3", title: "Tile crew can't start", description: "Tile crew is unable to begin without material.", entities: ["tile", "tile crew"], severity: "MEDIUM" as const },
    ];
    const day4 = { id: "d4", title: "Need to reschedule tile crew", description: "Tile crew needs to be rescheduled again.", entities: ["tile crew"], severity: "MEDIUM" as const };
    const result = detectSilentRisk(prior, day4);
    expect(result).not.toBeNull();
    expect(result!.involvedCount).toBe(4);
  });

  it("does not escalate if any involved event was already HIGH/CRITICAL on its own", () => {
    const prior = [
      { id: "f1", title: "Tile delayed", description: "Tile delayed badly.", entities: ["tile"], severity: "HIGH" as const },
      { id: "f2", title: "Tile crew idle", description: "Tile crew idle again.", entities: ["tile"], severity: "LOW" as const },
    ];
    const newEvent = { id: "f3", title: "Tile reschedule needed", description: "Tile crew reschedule needed.", entities: ["tile"], severity: "LOW" as const };
    expect(detectSilentRisk(prior, newEvent)).toBeNull();
  });
});
