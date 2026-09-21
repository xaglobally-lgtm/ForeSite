import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { detectAgingAlerts } from "@/lib/risk-engine";

/**
 * R010 (spec §21) exposed as an endpoint. Cheap enough to compute on read —
 * no need to store "is this aging" as a column that could go stale. A cron
 * job could also hit this per-company and call notifyAlert-style delivery
 * for anything it returns; not wired to notifications automatically here
 * since "open too long" re-checking every few minutes would otherwise spam
 * the same alert repeatedly without its own dedup story.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const openAlerts = await prisma.alert.findMany({
    where: { project: { companyId: session.companyId }, status: "OPEN" },
    select: { id: true, severity: true, status: true, createdAt: true, title: true, projectId: true },
  });

  const aging = detectAgingAlerts(openAlerts);
  const byId = new Map(openAlerts.map((a) => [a.id, a]));
  const enriched = aging.map((a) => ({ ...a, title: byId.get(a.alertId)?.title, projectId: byId.get(a.alertId)?.projectId }));

  return NextResponse.json({ aging: enriched });
}
