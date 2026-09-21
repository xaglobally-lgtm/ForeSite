import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

export const PLAN_PRICE_IDS: Record<"STARTER" | "PRO" | "BUSINESS", string | undefined> = {
  STARTER: process.env.STRIPE_PRICE_STARTER,
  PRO: process.env.STRIPE_PRICE_PRO,
  BUSINESS: process.env.STRIPE_PRICE_BUSINESS,
};

export const PLAN_PROJECT_LIMITS: Record<"STARTER" | "PRO" | "BUSINESS", number> = {
  STARTER: 5,
  PRO: 15,
  BUSINESS: 999, // "larger" per spec §56 — set a real ceiling once pricing is finalized
};
