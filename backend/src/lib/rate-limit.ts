/**
 * Minimal in-memory sliding-window rate limiter.
 *
 * Honest limitation: this only works correctly on a single long-running
 * server process. On serverless platforms (Vercel, Lambda) each instance
 * has its own memory, so a determined abuser spread across instances gets
 * a much higher effective limit than the number below implies. This is
 * still strictly better than no limit at all for casual abuse, but before
 * relying on this for real cost protection, swap it for a shared store —
 * Upstash Redis and Vercel KV both have small, drop-in rate-limit helpers.
 *
 * Used by /api/free-scan, the one unauthenticated route that calls the
 * Claude API.
 */

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS_PER_WINDOW = 5;

const hits = new Map<string, number[]>();

export function checkRateLimit(key: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const timestamps = (hits.get(key) ?? []).filter((t) => t > windowStart);

  if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    hits.set(key, timestamps);
    return { allowed: false, remaining: 0 };
  }

  timestamps.push(now);
  hits.set(key, timestamps);
  return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - timestamps.length };
}

/** Best-effort client identifier from standard proxy headers. Not spoof-proof
 *  (a client can fake X-Forwarded-For) — fine for abuse-slowing, not for
 *  anything security-critical. */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
