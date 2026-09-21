import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, requireRole } from "@/lib/session";
import { stripe, PLAN_PRICE_IDS } from "@/lib/stripe";
import { z } from "zod";

const CheckoutSchema = z.object({ plan: z.enum(["STARTER", "PRO", "BUSINESS"]) });

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  requireRole(session, ["OWNER", "ADMIN"]); // only owners/admins can change billing

  const { plan } = CheckoutSchema.parse(await req.json());
  const priceId = PLAN_PRICE_IDS[plan];
  if (!priceId) return NextResponse.json({ error: `No Stripe price configured for ${plan}` }, { status: 500 });

  const company = await prisma.company.findUnique({ where: { id: session.companyId }, include: { subscription: true } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  let stripeCustomerId = company.subscription?.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({ name: company.name, metadata: { companyId: company.id } });
    stripeCustomerId = customer.id;
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing?success=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing?canceled=true`,
    metadata: { companyId: company.id, plan },
  });

  return NextResponse.json({ url: checkoutSession.url });
}
