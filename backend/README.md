# Jobsite Intelligence — Backend

Real Next.js / TypeScript / PostgreSQL / Prisma implementation of the core spec,
built as the production counterpart to the browser prototype. This is source
code you take to your own machine and run — it hasn't been `npm install`ed or
started anywhere yet.

## What's actually implemented here

- **`prisma/schema.prisma`** — the full domain model from spec §12 (companies,
  users, roles, projects, raw inputs, events, event relationships, exposures,
  alerts, actions, outcomes, feedback, financial assumptions, subscriptions,
  audit logs), plus the Auth.js-required Account/Session/VerificationToken
  tables.
- **`src/lib/risk-engine.ts`** — the deterministic severity/financial/alert-gate/
  double-counting/project-matching engine, plus the R010 aging-alert detector and
  the R009 "management doesn't know" silent-risk detector — both ported from the
  browser prototype and re-verified here with real *executed* tests (compiled and
  run directly, not just type-checked — see the note at the bottom of this file).
  Pure functions, zero LLM calls.
- **`src/lib/notifications.ts`** — severity-based delivery per spec §53: Critical/High
  create an immediate in-app + email notification row; Medium batches into a daily
  digest (`sendDailyDigest()`, meant to run on a cron); Low stays dashboard-only,
  no notification row at all. The actual SMTP send call is a marked `TODO` — which
  provider you pick (Postmark/Resend/SES) determines that call's exact shape.
- **`src/lib/extraction.ts`** — the Claude API call that turns raw input into
  structured events (text, image, or PDF), plus the grounded Ask My Jobs
  explainer.
- **`src/lib/pipeline.ts`** — wires extraction → risk engine → Postgres → notifications,
  including the recurring-problem detector (spec §50) and the silent-risk detector
  now running against each project's recent event history on every new input.
- **`src/lib/auth.ts` + `src/lib/session.ts`** — real auth via Auth.js
  (email magic-link + Prisma adapter) and the tenant-isolation layer every
  route depends on. A user's `companyId` is resolved from their verified
  session and checked against real `CompanyUser` membership — never trusted
  from a client-supplied value alone.
- **`src/lib/stripe.ts`** + **`/api/billing/*`** — checkout session creation,
  billing portal, and a webhook that keeps the `Subscription` table in sync
  with Stripe (checkout completion, subscription updates/cancellations).
- **API routes**:
  - `/api/companies` — one-time company + OWNER-membership bootstrap (the
    backend counterpart of "Tell us about your company")
  - `/api/projects`, `/api/inputs`, `/api/inputs/:id/process`
  - `/api/alerts`, `/api/alerts/:id`, `/api/alerts/:id/feedback` (learning
    loop, spec §52), `/api/alerts/aging` (R010, pollable by a dashboard or cron)
  - `/api/exposures`, `/api/daily-brief`, `/api/ask`
  - `/api/notifications` — list + mark-read for the current user
  - `/api/free-scan` — public, unauthenticated, the lead-gen flow (spec §54)
  - `/api/billing/checkout`, `/api/billing/portal`, `/api/billing/webhook`
  - `/api/auth/[...nextauth]` — Auth.js handler

## What's now real, not just scaffolded

- **File storage** — `storage.ts` uses the real AWS S3 API (works unchanged with
  actual S3, or any S3-compatible provider — Cloudflare R2, Backblaze B2 — by
  setting `S3_ENDPOINT`). Presigned upload flow: `POST /api/uploads` returns a
  time-limited PUT URL, the frontend uploads the photo/PDF directly to storage
  (never through the Next.js server, so a phone photo doesn't hit a serverless
  body-size limit), then the returned key is submitted as `RawInput.fileUrl`.
  `pipeline.ts` fetches it back via signed GET when it's time to run extraction.
  Also includes the file-type and size validation spec §58 calls for, and
  `GET /api/raw-inputs/:id` for viewing evidence behind an alert (spec §72)
  with its own time-limited read URL — the bucket itself is never public.
- **Email** — `email.ts` sends through nodemailer using the same
  `EMAIL_SERVER`/`EMAIL_FROM` Auth.js already needs. `notifyAlert()` and
  `sendDailyDigest()` both call it for real; a `Notification` row's `sentAt`
  reflects an actual send attempt (`null` means it was tried and failed —
  visible for retry/audit, not silently swallowed).
- **The daily digest has somewhere to run.** `POST /api/cron/daily-digest`,
  secret-protected, wired to `vercel.json`'s cron config (13:00 UTC daily —
  adjust to taste).
- **`/api/free-scan` is rate-limited.** 5 requests/hour/IP by default
  (`rate-limit.ts`), actually executed and tested, not just typed.
- **Analytics events fire from real call sites**, not just documented as a
  future list: signup/trial start, project creation, input submit/process,
  event/alert creation (from inside the pipeline itself), alert view, action
  creation, outcome recording, all four feedback verdicts, free-scan
  start/complete, and Stripe subscription start/upgrade/cancel.

## What you still need to add before this runs

1. **Provision a real bucket.** Create the S3/R2/B2 bucket, set
   `S3_BUCKET`/`S3_REGION`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` (and
   `S3_ENDPOINT` if not using real AWS S3) in `.env`.
2. **Malware scanning on uploads** (spec §58 says "where practical") — not
   implemented. File-type and size validation are real (`storage.ts`); virus
   scanning would mean adding a service like ClamAV or a cloud provider's
   scanning API to the upload flow, which is enough of its own integration
   that it didn't fit in this pass.
3. **Stripe dashboard setup.** Create the three price objects and set
   `STRIPE_PRICE_STARTER/PRO/BUSINESS`, plus register the webhook URL and set
   `STRIPE_WEBHOOK_SECRET` from the Stripe dashboard.
4. **Set `CRON_SECRET`** in `.env` and point your scheduler (Vercel Cron via
   `vercel.json`, already included, or any other scheduler) at
   `/api/cron/daily-digest`.
5. **Swap the rate limiter for a shared store before relying on it.**
   `rate-limit.ts` is real and tested, but it's in-memory — correct on a
   single long-running server, under-effective across multiple serverless
   instances. Upstash Redis or Vercel KV both have drop-in replacements.
6. **Point analytics at a real dashboard once you want one.** Events land in
   your own `AnalyticsEvent` table for now (queryable with plain SQL) —
   `analytics.ts`'s `track()` is the one place to redirect to PostHog/Segment/
   Amplitude later.
7. Not yet wired: the feedback route's verdicts are tracked, but nothing yet
   *acts* on that signal (spec §51's company-specific tuning is future work).

## Setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, ANTHROPIC_API_KEY, EMAIL_SERVER,
                        # NEXTAUTH_SECRET (openssl rand -base64 32) at minimum
npx prisma migrate dev --name init
npm run test            # runs the risk-engine unit tests
npm run dev
```

First-run flow: a person signs in via the emailed magic link (creates their
`User` row via the Auth.js adapter), then the frontend calls
`POST /api/companies` once to create their company and OWNER membership —
that's the "Tell us about your company" step. Every route after that resolves
`companyId` from their session automatically.

## Design note: why the risk/financial engine has zero LLM calls

Severity scores and dollar exposures must be the same number every time you
look at them, and explainable when someone asks "why does it say $4,800?".
The extraction layer (`extraction.ts`) is the only place that talks to Claude
— it hands back structured facts and 0–100 risk factors. Everything from
there (`risk-engine.ts`) is ordinary, testable, deterministic code. This
mirrors the prototype and satisfies spec §22 and §60's "never let the LLM
determine risk alone" rule.

## Design note: why companyId comes from a header, not the URL or body

`getSession()` reads `x-company-id` from the request headers and cross-checks
it against real `CompanyUser` rows — it never trusts a companyId embedded in
a URL param or request body, because that would let one company's logged-in
user simply edit a request to read another company's data. If the header is
missing, it falls back to the user's first active membership, which covers
the common single-company case without the frontend needing to manage it.

## Verification note

`npm install` was never possible in the environment this was built in (no
network access), so nothing here has actually run against a live Postgres
database or a real Stripe/Anthropic account. What *was* done: every file
passes `tsc --noEmit` with zero errors beyond the expected "Prisma client
hasn't been generated yet" noise, and — for the two newly-ported detectors in
`risk-engine.ts` — the actual compiled JavaScript was executed with real
assertions (not just type-checked), including the exact scenario from the
spec's own R009 example, and it passed. That's real verification of the
logic; it is not the same thing as this app having run.

