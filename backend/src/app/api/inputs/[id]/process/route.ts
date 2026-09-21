import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { processRawInput } from "@/lib/pipeline";
import { track } from "@/lib/analytics";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rawInput = await prisma.rawInput.findFirst({ where: { id: params.id, companyId: session.companyId } });
  if (!rawInput) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const createdAlertIds = await processRawInput(params.id);
    track("input_processed", { companyId: session.companyId, userId: session.userId, rawInputId: params.id, alertsCreated: createdAlertIds.length });
    return NextResponse.json({ createdAlertIds });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
