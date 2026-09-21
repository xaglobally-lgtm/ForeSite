import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, ApiError } from "@/lib/session";
import { track } from "@/lib/analytics";
import { z } from "zod";

const CreateProjectSchema = z.object({
  name: z.string().min(1),
  clientName: z.string().optional(),
  address: z.string().optional(),
  contractValue: z.number().optional(),
  estimatedStart: z.string().datetime().optional(),
  estimatedCompletion: z.string().datetime().optional(),
  projectManagerId: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projects = await prisma.project.findMany({
      where: { companyId: session.companyId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ projects });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = CreateProjectSchema.parse(await req.json());

    // Enforce plan project-count limits server-side (spec §57 — never client-side only).
    const sub = await prisma.subscription.findUnique({ where: { companyId: session.companyId } });
    if (sub) {
      const count = await prisma.project.count({ where: { companyId: session.companyId, status: "ACTIVE" } });
      if (count >= sub.projectLimit) {
        return NextResponse.json({ error: `Plan limit reached (${sub.projectLimit} active projects).` }, { status: 402 });
      }
    }

    const project = await prisma.project.create({
      data: { ...body, companyId: session.companyId },
    });

    await prisma.auditLog.create({
      data: { companyId: session.companyId, userId: session.userId, action: "project.created", entityType: "Project", entityId: project.id },
    });
    track("project_created", { companyId: session.companyId, userId: session.userId, projectId: project.id });

    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown) {
  if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
