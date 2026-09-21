import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { track } from "@/lib/analytics";
import { z } from "zod";

const PatchSchema = z.object({
  status: z.enum(["OPEN", "ACKNOWLEDGED", "ACTIONED", "DISMISSED", "RESOLVED"]).optional(),
  createAction: z.object({ title: z.string(), dueAt: z.string().datetime().optional() }).optional(),
  outcome: z
    .object({
      type: z.enum(["REVENUE_CAPTURED", "COST_AVOIDED", "SCHEDULE_RECOVERED", "ISSUE_RESOLVED", "FALSE_POSITIVE", "NO_ACTION_REQUIRED"]),
      amount: z.number().optional(),
      verified: z.boolean().default(true),
    })
    .optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const alert = await prisma.alert.findFirst({
    where: { id: params.id, project: { companyId: session.companyId } },
    include: { event: { include: { source: true } }, exposure: true, actions: true, outcomes: true },
  });
  if (!alert) return NextResponse.json({ error: "Not found" }, { status: 404 });
  track("alert_viewed", { companyId: session.companyId, userId: session.userId, alertId: alert.id });
  return NextResponse.json({ alert });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = PatchSchema.parse(await req.json());
  const alert = await prisma.alert.findFirst({ where: { id: params.id, project: { companyId: session.companyId } } });
  if (!alert) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (body.status) {
    await prisma.alert.update({
      where: { id: alert.id },
      data: { status: body.status, resolvedAt: body.status === "RESOLVED" ? new Date() : undefined },
    });
    await prisma.auditLog.create({
      data: { companyId: session.companyId, userId: session.userId, action: "alert.status_changed", entityType: "Alert", entityId: alert.id, metadata: { status: body.status } },
    });
  }

  if (body.createAction) {
    await prisma.action.create({
      data: { alertId: alert.id, projectId: alert.projectId, assignedTo: session.userId, title: body.createAction.title, dueAt: body.createAction.dueAt ? new Date(body.createAction.dueAt) : undefined },
    });
    track("action_created", { companyId: session.companyId, userId: session.userId, alertId: alert.id });
  }

  if (body.outcome) {
    await prisma.outcome.create({
      data: { alertId: alert.id, type: body.outcome.type, amount: body.outcome.amount, verified: body.outcome.verified, createdById: session.userId },
    });
    track("outcome_recorded", { companyId: session.companyId, userId: session.userId, alertId: alert.id, type: body.outcome.type, amount: body.outcome.amount });
  }

  const updated = await prisma.alert.findUnique({ where: { id: alert.id }, include: { actions: true, outcomes: true } });
  return NextResponse.json({ alert: updated });
}
