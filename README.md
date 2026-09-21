# Foresite — Complete Package

Everything built so far, in one place. This is a working product-front (the
single-file app is deployable on Vercel today) plus a scaffolded production
backend for the next phase. Read "Where things actually stand" before showing
this to anyone else.

## What's in here

```
app/                 THE PRODUCT FRONT. ship the contents of this folder to Vercel.
app/foresite.html    Single-file app. Real Claude API calls, 14 languages,
                     light/dark mode, multi-currency display, offline PWA,
                     draggable panels, voice/photo/PDF input, full detection
                     engine. Runs entirely client-side; data stays in the
                     user's browser (IndexedDB).

app/manifest.webmanifest, sw.js, icon.svg   PWA files (installable / offline).

backend/             A real Next.js + TypeScript + PostgreSQL + Prisma
                     implementation of the same logic, meant to become
                     the actual multi-user product. See backend/README.md —
                     what's real vs. what still needs configuration.

docs/                Foresite-SPECIFICATIONS-BUILD-DOC.md  (build + sales spec)
                     Foresite-USER-MANUAL.md                (how-to, in the
                     same plain language, updated to cover the new UI)
                     Foresite-Manual.docx                   (earlier draft)

legal/*.docx         Terms of Service and Privacy Policy DRAFTS.
                     Every bracketed [placeholder] needs a real answer,
                     and a licensed attorney needs to review both before
                     either goes in front of a real customer.
```

## Where things actually stand

**Proven, with real testing, not just claims:**
- The detection logic (10 rules from the spec, deterministic risk/financial
  scoring, double-counting protection, project auto-matching) — verified with
  34 passing acceptance tests run against actual code execution.
- Every backend TypeScript file type-checks cleanly.
- The app's single `<script>` parses and passes an automated consistency audit:
  all 14 language dictionaries have identical key sets (177 keys each) and
  every `t('...')` call in the code resolves. All 14 languages render.
- Every screen renders without errors across all 6 original languages — checked
  with a headless render test.

**Built but never run end-to-end:**
- The backend has never connected to a real database, sent a real email,
  called real Stripe, or stored a real file. Type-checking is real
  verification; it is not the same claim as "this runs."
- The app's free-scan/Ask/extraction paths are *wired* (API key field, auth
  headers, friendly errors) but have not been exercised against a paid
  Anthropic key from a real browser yet.
- The app's AI extraction quality on messy real jobsite text hasn't been
  validated — only on constructed examples and manual extraction runs.

**Not built at all:**
- Malware scanning on file uploads.
- Company-specific pattern learning (spec's long-term "moat" feature) —
  the feedback signal is captured, nothing acts on it yet.
- Native mobile apps, SMS/WhatsApp integration, accounting/ERP connections —
  all explicitly out of scope per the original spec anyway.

## Two-stage launch plan (agreed)

**Stage 1 — get something live this month (free, static).**
1. Deploy the `app/` folder to a free Vercel account (5-minute setup, exact
   click-by-click steps are in the build doc at `docs/Foresite-SPECIFICATIONS-BUILD-DOC.md`).
2. Test it as a brand-new customer using the checklist in the build doc.
3. Get ONE real contractor using it. Money model: free-first; charge later for
   outcomes, not for a subscription wall at signup.

**Stage 2 — the real product (backend).**
1. `cd backend && npm install && cp .env.example .env` (fill in `DATABASE_URL`
   and `ANTHROPIC_API_KEY`), then `npx prisma migrate dev`.
2. Feed it a real week of messy field notes from an actual job — this tells
   you whether the alerts are good enough to charge for.
3. Finish the legal documents with an actual attorney.
4. Pick infrastructure: a Postgres host, S3-compatible bucket, SMTP provider,
   Stripe price IDs. All coded against; none provisioned.
5. Migrate users and turn on real accounts/billing.

Steps that are most likely to surface something needing a code change: Stage 2
step 2 (real data hits the engine) and Stage 1 step 3 (a real person's browser
is the first real client). Budget for another round of fixes, not zero.
