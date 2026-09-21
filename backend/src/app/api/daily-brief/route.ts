import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * Deterministic, not LLM-generated (spec §43: "no giant AI essay"). Counts and
 * templating only — reliability matters more than prose variety here.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projects = await prisma.project.findMany({ where: { companyId: session.companyId, status: "ACTIVE" } });
  const openAlerts = await prisma.alert.findMany({
    where: { project: { companyId: session.companyId }, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
    include: { project: true },
    orderBy: { severity: "asc" },
  });

  const urgent = openAlerts.filter((a) => a.severity === "CRITICAL").length;
  const important = openAlerts.filter((a) => a.severity === "HIGH").length;
  const projectsWithIssues = new Set(openAlerts.map((a) => a.projectId)).size;
  const healthy = Math.max(0, projects.length - projectsWithIssues);

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weekExposures = await prisma.exposure.findMany({
    where: { project: { companyId: session.companyId }, hasAmount: true, createdAt: { gte: weekAgo } },
  });
  const weekLow = weekExposures.reduce((s, e) => s + (e.lowAmount ?? 0), 0);
  const weekHigh = weekExposures.reduce((s, e) => s + (e.highAmount ?? 0), 0);

  const weekOutcomes = await prisma.outcome.findMany({
    where: { verified: true, createdAt: { gte: weekAgo }, alert: { project: { companyId: session.companyId } } },
  });
  const verified = weekOutcomes.reduce((s, o) => s + (o.amount ?? 0), 0);

  return NextResponse.json({
    activeProjects: projects.length,
    urgent,
    important,
    healthy,
    topPriorities: openAlerts.slice(0, 3).map((a) => ({ id: a.id, project: a.project.name, title: a.title, severity: a.severity })),
    weekPotentialExposure: { low: weekLow, high: weekHigh },
    weekVerifiedValue: verified,
  });
}
