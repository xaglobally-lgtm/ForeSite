import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const unreadOnly = req.nextUrl.searchParams.get("unread") === "true";

  const notifications = await prisma.notification.findMany({
    where: { userId: session.userId, companyId: session.companyId, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ notifications });
}

const MarkReadSchema = z.object({ ids: z.array(z.string()).min(1) });

export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ids } = MarkReadSchema.parse(await req.json());
  await prisma.notification.updateMany({
    where: { id: { in: ids }, userId: session.userId },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
