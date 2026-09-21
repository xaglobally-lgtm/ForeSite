import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, ApiError } from "@/lib/session";
import { guessProjectId } from "@/lib/risk-engine";
import { track } from "@/lib/analytics";
import { z } from "zod";

const CreateInputSchema = z.object({
  projectId: z.string().optional(), // omit to trigger auto-detection
  type: z.enum(["VOICE", "TEXT", "PHOTO", "PDF", "EMAIL", "CSV", "EXCEL"]),
  contentText: z.string().optional(),
  fileUrl: z.string().optional(),
  fileMediaType: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = CreateInputSchema.parse(await req.json());

    let projectId = body.projectId ?? null;
    if (!projectId) {
      // Project identification, spec §10 — never silently attach to the wrong job.
      const projects = await prisma.project.findMany({
        where: { companyId: session.companyId, status: "ACTIVE" },
        select: { id: true, name: true, clientName: true, address: true },
      });
      const guess = guessProjectId(body.contentText ?? "", projects);
      if (!guess.confident) {
        return NextResponse.json(
          { error: "AMBIGUOUS_PROJECT", message: "Which project is this for?", candidates: projects },
          { status: 409 }
        );
      }
      projectId = guess.projectId;
    }

    const rawInput = await prisma.rawInput.create({
      data: {
        companyId: session.companyId,
        projectId,
        submittedById: session.userId,
        type: body.type,
        contentText: body.contentText,
        fileUrl: body.fileUrl,
        fileMediaType: body.fileMediaType,
      },
    });

    track("input_submitted", { companyId: session.companyId, userId: session.userId, type: body.type, projectId });

    return NextResponse.json({ rawInput }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
