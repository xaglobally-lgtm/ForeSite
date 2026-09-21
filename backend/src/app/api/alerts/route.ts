import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { uniqueExposureTotal } from "@/lib/risk-engine";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("projectId");

  const alerts = await prisma.alert.findMany({
    where: { project: { companyId: session.companyId }, ...(projectId ? { projectId } : {}) },
    orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
    include: { exposure: true },
  });

  const exposures = await prisma.exposure.findMany({
    where: { project: { companyId: session.companyId }, ...(projectId ? { projectId } : {}), hasAmount: true },
    include: { event: { select: { chainId: true } } },
  });

  const grossTotal = { low: exposures.reduce((s, e) => s + (e.lowAmount ?? 0), 0), high: exposures.reduce((s, e) => s + (e.highAmount ?? 0), 0) };
  const uniqueTotal = uniqueExposureTotal(exposures.map((e) => ({ chainId: e.event.chainId, highAmount: e.highAmount })));

  return NextResponse.json({ alerts, exposureSummary: { grossTotal, uniqueTotal } });
}
