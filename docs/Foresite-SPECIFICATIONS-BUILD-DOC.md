# Foresite — Specifications, Build Doc & Launch Plan

Plain-language spec of **what the product is**, **what was built**, and the
exact steps to **get it live and sellable** — written for a non-developer owner.
Last updated with the Stage-1 (static, free) build.

---

## 1. What Foresite is

A jobsite-intelligence tool for contractors. Field teams already produce the
information (voice notes, texts, photos, documents). Foresite reads it and
tells the owner **which problems are real, how much they may cost, and what to
do today** — before they become change orders, punch lists, or disputes.

### The benefits, in one line each
- **Money leakage detection** — finds unapproved work, unbilled extras, delays.
- **Time** — a morning briefing instead of chasing five foremen for status.
- **Accountability** — every alert is tied to the original field evidence.
- **Paper trail** — photos/documents become structured, dated, searchable records.
- **Language-proof** — works in the language the crew actually writes in (14).

### Who pays, and how (decision already made)
- **Who pays:** the general contractor / company owner. Not the field crew.
- **Payments:** free-first. Stage 1 charges nothing. Stage 2 (real accounts)
  charges for **outcomes** (revenue captured / cost avoided / schedule
  recovered) — pay-by-outcome, not a subscription wall. There is **no payment
  handling in Stage 1**, so there is nothing to break.

## 2. What must work (acceptance bar)

1. Open the deployed URL → onboarding wizard in my language, no account needed.
2. Create a project → submit a voice/text/photo/PDF field update.
3. Within seconds the pipeline turns it into events → exposures → alerts,
   each linked back to the original input.
4. Dashboard shows active jobs, gross + unique risk ranges, open issues.
5. Alerts open a modal: what happened, why it matters, confidence, cost range,
   evidence, recommended action. Acknowledge / create action / resolve /
   dismiss; record a verified outcome (value added appears in the dashboard).
6. Graph shows causal chains (cascade from one input; cross-input links).
7. Daily briefing, Ask My Jobs, and the free "Profit Leak Scan" all answer
   only from detected data — never invent anything.
8. Light/dark mode, 14 languages, any of 22 display currencies, no page
   scrolling, draggable split panels, installable + offline as a PWA.
9. Everything persists in the browser (IndexedDB) across reloads.

## 3. What's built (this Stage-1 build)

- **`app/foresite.html`** — the entire product in one file.
- **14 languages** — English, Spanish, Korean, Chinese, Arabic, Thai,
  Vietnamese, Indonesian, Portuguese, French, German, Turkish, Japanese, Hindi.
- **Light/dark theme** — toggle top-right, remembered on reload, light palette
  hand-tuned, not just a CSS flip.
- **Multi-currency** — 22 currencies, formatted with each region's convention.
- **Admin section** separated in the sidebar (Settings + About) from the daily
  tools (Inbox, Portfolio, Alerts, Graph, Brief, Ask, Scan).
- **Next-touch guidance** — the primary button on each screen glows.
- **No page scrolling** — app frame is a fixed-height dashboard; only internal
  lists scroll. Panel dividers are **draggable** and remember each screen's layout.
- **Friendly AI-key UX** — Settings → AI key field; capture/Ask/Scan all tell
  you clearly when no key is set or the API returned an error.
- **Offline PWA** — `manifest.webmanifest`, `sw.js`, `icon.svg`; installable
  and works with no network for everything except AI calls.
- **About/Contact** — legal docs (drafts), contact, and a feedback box that
  opens the user's email app.

## 4. Data & privacy posture (Stage 1)

- All state lives in the user's browser (IndexedDB). Nothing is uploaded to
  any server except directly to Anthropic's API for AI analysis when the user
  supplies their own API key.
- The AI key never leaves their browser; it's sent only in the request header
  to api.anthropic.com over HTTPS.
- Legal documents are **drafts** with `[placeholders]` — an attorney must
  review before any real customer relies on them.

## 5. How to deploy (Stage 1 — free, ~30 minutes, first time)

No code, no terminal — the Vercel web UI:

1. Go to **vercel.com** → "Sign Up" → "Sign in with GitHub" (free plan).
   Accept the default billing prompt — the hobby plan is free, no card needed.
2. In Vercel: **Add New… → Project → Import** a repository, or if your Foresite
   folder isn't in GitHub yet: create a repo on github.com, upload the four
   files from the `app/` folder (foresite.html, manifest.webmanifest, sw.js,
   icon.svg), then Import it.
3. Vercel auto-detects it as a static site → **Deploy**.
4. After deploy: open **Settings → General** and set the **Output directory**,
   if prompted, then open **Settings → Domains** and note your `https://xxx.vercel.app`
   address. (Vercel auto-exposes the file at `/<project>.vercel.app/foresite.html`.)
5. Test the finished URL as a brand-new customer using the checklist below.

(There is no build command needed — it's a plain static site.)

## 6. Go-live checklist (test as a brand-new customer)

- [ ] URL opens on a phone (data, not WiFi) and a desktop.
- [ ] Onboarding: switch to a different language mid-wizard, complete setup.
- [ ] Inbox: submit a text update; a real alert appears with the AI key set.
- [ ] No-key behaviour: clear the AI key → submit → clear "set your AI key" message.
- [ ] Bad-key behaviour: paste `sk-ant-test-invalid` → submit → friendly error.
- [ ] Photo upload and a PDF upload both process (first photo/PDF may need a
      browser prompt for the v1 model — note it).
- [ ] Dashboard numbers change after resolving an alert with a recorded outcome.
- [ ] Graph shows one input producing a cascade; Brief shows the top items.
- [ ] Light/dark toggle survives a reload; currency change reformats all money.
- [ ] Drag a panel divider → reload → layout is remembered.
- [ ] Install as an app: try "Add to Home Screen" (Android/desktop) → opens
      fullscreen, works offline after the first load.
- [ ] Scan page runs without an account and offers account conversion.

## 7. Sales summary (how to tell the story fast)

> "Your crews already tell you what's going on — in voice notes, texts and
> photos. Foresite reads that flow and tells you, every morning, which loose
> threads are actually going to cost you money — and how much. When you act
> on it, you record the outcome, and the product keeps score."

Demo script (60 seconds): open the site → tap **Free Scan** → paste 3 messy
field notes → show the resulting money ranges → "this is what your inbox would
look like every day."

Simple pricing story for Stage 2 (not implemented yet): free to try; you pay
only for confirmed outcomes. Never pay for alerts that don't pan out.

## 8. Next build (Stage 2 — the backend product)

Covered in `../README.md`. Order of operations:
1. Run the Next.js backend locally (`npm install`, `.env`, `prisma migrate`).
2. Real-data test with a week of real field notes.
3. Attorney review of the legal drafts; finalize pricing + retention terms.
4. Provision Postgres, S3, SMTP, Stripe; deploy backend; real accounts.

---

*Any `[bracket]` in this repo means "decision still needed." The code is
finished; the decisions are not.*