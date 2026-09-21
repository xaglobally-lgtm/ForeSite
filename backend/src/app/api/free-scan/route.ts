import { NextRequest, NextResponse } from "next/server";
import { extractEvents } from "@/lib/extraction";
import { computeSeverity, computeExposure, FinancialAssumptions } from "@/lib/risk-engine";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { track } from "@/lib/analytics";
import { z } from "zod";

const ScanSchema = z.object({ text: z.string().min(1).max(5000) });

// Sensible defaults for an anonymous visitor who hasn't configured anything yet.
const DEFAULT_ASSUMPTIONS: FinancialAssumptions = {
  loadedLaborRate: 65, typicalCrewSize: 4, dailyOverhead: 400, defaultMarkup: 0.18, materialMarkup: 0.12,
};

/**
 * Free Job Profit Leak Scan (spec §54-55) — the lead-generation flow. Deliberately
 * NOT behind getSession(): this is the pre-signup experience. No data is
 * persisted here; the frontend re-submits the same text through the normal
 * authenticated pipeline (POST /api/inputs + /api/inputs/:id/process) if the
 * visitor converts to a real account.
 *
 * Rate-limited by IP (see rate-limit.ts for the honest caveat about
 * serverless instances) since this is the one unauthenticated route that
 * calls the Claude API.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { allowed } = checkRateLimit(`free-scan:${ip}`);
  if (!allowed) {
    return NextResponse.json({ error: "Too many scans from this address. Try again in a bit, or create a free account." }, { status: 429 });
  }

  const { text } = ScanSchema.parse(await req.json());
  track("free_scan_started", { ip });

  let extracted;
  try {
    extracted = await extractEvents({ kind: "text", text });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Scan failed" }, { status: 500 });
  }

  const results = extracted
    .map((raw) => {
      const { score, band } = computeSeverity(raw.risk_factors);
      const exposure = computeExposure(
        raw.type, raw.confidence,
        {
          affectedHours: raw.financial_signals.affected_hours,
          materialQuantity: raw.financial_signals.material_quantity,
          materialUnit: raw.financial_signals.material_unit,
          knownUnitCost: raw.financial_signals.known_unit_cost,
          statedDollarAmount: raw.financial_signals.stated_dollar_amount,
        },
        DEFAULT_ASSUMPTIONS
      );
      return { ...raw, severityScore: score, severity: band, exposure };
    })
    .sort((a, b) => b.severityScore - a.severityScore);

  const withAmount = results.filter((r) => r.exposure.hasAmount);
  const totalLow = withAmount.reduce((s, r) => s + (r.exposure.lowAmount ?? 0), 0);
  const totalHigh = withAmount.reduce((s, r) => s + (r.exposure.highAmount ?? 0), 0);

  track("free_scan_completed", { ip, eventsFound: results.length });

  return NextResponse.json({ events: results, totalExposure: { low: totalLow, high: totalHigh } });
}
