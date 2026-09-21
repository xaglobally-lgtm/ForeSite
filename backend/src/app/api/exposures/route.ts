import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("projectId");
  const category = req.nextUrl.searchParams.get("category"); // REVENUE_OPPORTUNITY | COST_EXPOSURE | SCHEDULE_EXPOSURE

  const exposures = await prisma.exposure.findMany({
    where: {
      project: { companyId: session.companyId },
      ...(projectId ? { projectId } : {}),
      ...(category ? { category: category as any } : {}),
    },
    include: { event: { select: { title: true, type: true, chainId: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ exposures });
}
