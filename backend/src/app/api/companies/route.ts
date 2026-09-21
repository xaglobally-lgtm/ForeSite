import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { track } from "@/lib/analytics";
import { z } from "zod";

const CreateCompanySchema = z.object({
  name: z.string().min(1),
  contractorType: z.string().optional(),
});

/**
 * Called once, right after a brand-new user's first sign-in — this is the
 * backend counterpart of the "Tell us about your company" onboarding screen.
 * Not scoped by getSession() (there's no company yet to scope by); it uses
 * the raw Auth.js session and creates the user's first OWNER membership.
 *
 * A user who already belongs to a company should not hit this again — the
 * frontend should route straight to the dashboard instead. We still guard
 * against it server-side rather than trusting the frontend to behave.
 */
export async function POST(req: NextRequest) {
  const authSession = await auth();
  if (!authSession?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.companyUser.findFirst({ where: { userId: authSession.user.id } });
  if (existing) {
    return NextResponse.json({ error: "User already belongs to a company." }, { status: 409 });
  }

  const body = CreateCompanySchema.parse(await req.json());

  const company = await prisma.company.create({
    data: {
      name: body.name,
      contractorType: body.contractorType,
      users: { create: { userId: authSession.user.id, role: "OWNER", status: "ACTIVE" } },
      assumptions: { create: {} }, // sensible defaults from the schema
      subscription: { create: { plan: "TRIAL", trialEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) } },
    },
  });

  track("signup_completed", { companyId: company.id, userId: authSession.user.id });
  track("trial_started", { companyId: company.id, userId: authSession.user.id });

  return NextResponse.json({ company }, { status: 201 });
}