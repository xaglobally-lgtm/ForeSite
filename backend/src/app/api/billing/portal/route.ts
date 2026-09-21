import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, requireRole } from "@/lib/session";
import { stripe } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  requireRole(session, ["OWNER", "ADMIN"]);

  const sub = await prisma.subscription.findUnique({ where: { companyId: session.companyId } });
  if (!sub?.stripeCustomerId) return NextResponse.json({ error: "No billing account yet" }, { status: 404 });

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing`,
  });

  return NextResponse.json({ url: portalSession.url });
}
