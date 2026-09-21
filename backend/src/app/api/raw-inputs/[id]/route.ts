import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getReadUrl } from "@/lib/storage";

/**
 * Evidence lookup (spec §72: every alert must let the user navigate back to
 * the original source — voice transcript, photo, or document). Raw inputs
 * are immutable, so this is read-only; no PATCH/DELETE on purpose.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rawInput = await prisma.rawInput.findFirst({ where: { id: params.id, companyId: session.companyId } });
  if (!rawInput) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const fileReadUrl = rawInput.fileUrl ? await getReadUrl(rawInput.fileUrl) : null;

  return NextResponse.json({ rawInput, fileReadUrl });
}
