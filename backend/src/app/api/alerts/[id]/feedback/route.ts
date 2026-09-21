import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { track } from "@/lib/analytics";
import { z } from "zod";

const FeedbackSchema = z.object({
  verdict: z.enum(["USEFUL", "NOT_USEFUL", "ALREADY_HANDLED", "NOT_IMPORTANT"]),
});

// Maps our verdict enum to spec §64's exact event names.
const VERDICT_EVENT_NAME: Record<string, string> = {
  USEFUL: "alert_useful",
  NOT_USEFUL: "alert_wrong",
  ALREADY_HANDLED: "alert_already_handled",
  NOT_IMPORTANT: "alert_dismissed",
};

/**
 * Learning loop (spec §52). This alone doesn't make detection smarter — no
 * retraining happens here — but it's the raw signal a future company-specific
 * tuning pass (spec §51) would need: which alerts this contractor actually
 * found useful vs. noise. Capture it faithfully now even before anything
 * downstream consumes it.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const alert = await prisma.alert.findFirst({ where: { id: params.id, project: { companyId: session.companyId } } });
  if (!alert) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { verdict } = FeedbackSchema.parse(await req.json());

  const feedback = await prisma.feedback.create({
    data: { alertId: alert.id, userId: session.userId, verdict },
  });
  track(VERDICT_EVENT_NAME[verdict], { companyId: session.companyId, userId: session.userId, alertId: alert.id });

  // "Already handled" and "not important" are useful signals for the alert
  // gate's future tuning, but also just mean this alert can close out now.
  if (verdict === "ALREADY_HANDLED" || verdict === "NOT_IMPORTANT") {
    await prisma.alert.update({ where: { id: alert.id }, data: { status: "DISMISSED" } });
  }

  await prisma.auditLog.create({
    data: { companyId: session.companyId, userId: session.userId, action: "alert.feedback", entityType: "Alert", entityId: alert.id, metadata: { verdict } },
  });

  return NextResponse.json({ feedback });
}
