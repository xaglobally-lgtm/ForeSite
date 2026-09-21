import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { stripe, PLAN_PROJECT_LIMITS } from "@/lib/stripe";
import { track } from "@/lib/analytics";
import Stripe from "stripe";

/**
 * Stripe webhook. NOT behind getSession() — Stripe calls this directly, so it
 * authenticates via the webhook signature instead (never trust an unverified
 * webhook body). Register this URL in the Stripe dashboard and set
 * STRIPE_WEBHOOK_SECRET from the same place.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error("Stripe webhook signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const checkoutSession = event.data.object as Stripe.Checkout.Session;
      const companyId = checkoutSession.metadata?.companyId;
      const plan = checkoutSession.metadata?.plan as "STARTER" | "PRO" | "BUSINESS" | undefined;
      if (companyId && plan && checkoutSession.subscription) {
        const existing = await prisma.subscription.findUnique({ where: { companyId } });
        await prisma.subscription.upsert({
          where: { companyId },
          create: {
            companyId,
            stripeCustomerId: checkoutSession.customer as string,
            stripeSubscriptionId: checkoutSession.subscription as string,
            plan,
            status: "active",
            projectLimit: PLAN_PROJECT_LIMITS[plan],
          },
          update: {
            stripeCustomerId: checkoutSession.customer as string,
            stripeSubscriptionId: checkoutSession.subscription as string,
            plan,
            status: "active",
            projectLimit: PLAN_PROJECT_LIMITS[plan],
          },
        });
        // "Started" if this company had no paid plan before (was TRIAL or nothing);
        // "upgraded" if they already had a different paid plan.
        const isUpgrade = existing && existing.plan !== "TRIAL" && existing.plan !== plan;
        track(isUpgrade ? "subscription_upgraded" : "subscription_started", { companyId, plan, previousPlan: existing?.plan });
      }
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      await prisma.subscription.updateMany({
        where: { stripeSubscriptionId: sub.id },
        data: { status: sub.status },
      });
      // Note: this event also fires for payment-method changes, renewals, etc.
      // — not every "updated" is a plan change, so we don't assume upgrade here
      // (the checkout.session.completed branch above handles actual plan changes).
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const updated = await prisma.subscription.updateMany({
        where: { stripeSubscriptionId: sub.id },
        data: { status: sub.status },
      });
      if (updated.count > 0) {
        const row = await prisma.subscription.findFirst({ where: { stripeSubscriptionId: sub.id } });
        if (row) track("subscription_cancelled", { companyId: row.companyId, plan: row.plan });
      }
      break;
    }
    default:
      // Unhandled event types are fine to ignore — Stripe sends many we don't act on.
      break;
  }

  return NextResponse.json({ received: true });
}
