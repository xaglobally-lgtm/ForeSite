import { NextRequest, NextResponse } from "next/server";
import { sendDailyDigest } from "@/lib/notifications";

/**
 * Not behind getSession() — there's no logged-in user, a scheduler calls
 * this directly. Authenticates via a shared secret instead (Vercel Cron
 * sends this automatically as a bearer token if you set CRON_SECRET in your
 * project; any other scheduler just needs to send the same header).
 *
 * Wire this to run once a day (early morning, company's local time zone is
 * a nice-to-have refinement — this version runs once for all companies
 * regardless of their timezone setting).
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendDailyDigest();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("Daily digest failed", err);
    return NextResponse.json({ error: "Digest failed" }, { status: 500 });
  }
}
