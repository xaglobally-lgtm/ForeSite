import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { answerFromEvidence } from "@/lib/extraction";
import { z } from "zod";

const AskSchema = z.object({ question: z.string().min(1) });

/**
 * Retrieval-then-explain (spec §45). We never hand the LLM free rein over the
 * whole database — we run a real query first, then ask it to explain only
 * what came back.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { question } = AskSchema.parse(await req.json());
  const words = question.toLowerCase().split(/\W+/).filter((w) => w.length > 3);

  const candidates = await prisma.alert.findMany({
    where: { project: { companyId: session.companyId } },
    include: { project: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const scored = candidates
    .map((a) => {
      const haystack = `${a.title} ${a.summary} ${a.whyItMatters} ${a.project.name}`.toLowerCase();
      const score = words.reduce((s, w) => s + (haystack.includes(w) ? 1 : 0), 0);
      return { a, score };
    })
    .sort((x, y) => y.score - x.score);

  const top = (scored.filter((s) => s.score > 0).slice(0, 8).map((s) => s.a).length
    ? scored.filter((s) => s.score > 0).slice(0, 8).map((s) => s.a)
    : candidates.slice(0, 8));

  const evidence = top.map((a) => ({
    project: a.project.name, severity: a.severity, title: a.title, summary: a.summary,
    why_it_matters: a.whyItMatters, recommended_action: a.recommendedAction, status: a.status, confidence: a.confidence,
  }));

  const answer = await answerFromEvidence(question, evidence);
  return NextResponse.json({ answer, evidence });
}
