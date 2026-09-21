# Foresite — User Manual

What Foresite is, how to use every screen, and what to do when something isn't
working. Written for a contractor, not a developer.

---

## 1. What is Foresite?

Foresite watches the information your team already produces every day — voice
notes, text messages, field photos, documents — and turns it into a short,
clear list of things that could cost you money or push your schedule.

It does not invent problems. Every alert traces back to an original field
update you can read, and every dollar figure is an estimate shown as a range,
with the logic that produced it.

Everything you enter stays in the browser on the device you use. There is no
account to create and nothing to install — it works offline as a web app.

## 2. First run

1. Open the link to Foresite.
2. Choose your language from the dropdown (top right). You can switch any time.
3. Enter your company details.
4. Enter your first project (name, client, address, contract value, program
   manager, expected completion).
5. Click **Start tracking**. That's the whole setup.

If you just want to look around first, click **Load demo company & project**.

## 3. The screen map

The left sidebar has two parts:

- **Your daily tools** (1–7): Inbox, Portfolio, Alerts, Event Graph, Daily
  Brief, Ask My Jobs, Free Scan.
- **Admin** (8–9): Settings and About/Contact. This is where you configure
  things rather than use them.

## 4. Inbox — "what's happening?"

The capture panel. Choose a mode:

- **Hold to talk** — press and hold the mic, speak a field update, stop, review
  the transcript, submit.
- **Write update** — type it, send.
- **Add photo** — take or attach a field photo, optional caption, analyze.
- **Add document** — upload a PDF (supplier notice, invoice, schedule), process.

Before submitting, pick which project it belongs to — or tap **Auto-detect**,
which reads the text and guesses. Double-check its guess.

The right side of this screen shows everything you've sent, in order, with the
events the AI pulled out of each one and the cost range it implies.

## 5. Portfolio — the numbers

- **Active jobs**: how many projects you track.
- **Gross potential risk**: the low–high total of everything detected.
- **Unique estimated risk**: the same total with cascades counted once, so a
  single original problem isn't counted three times.
- **Critical / High / Medium**: how many open alerts at each severity.
- **Verified protected value**: money you actually saved or captured, from
  outcomes you recorded.
- **Needs your attention** / **Open actions**: pick something to deal with.

## 6. Alerts — the work list

Open one: you see **what happened**, **why it matters**, **confidence**, **cost
range**, the **original evidence**, and a **recommended action**.

Your options:
- **Acknowledge** — "management knows."
- **Create action** — turn the recommendation into a tracked to-do.
- **Mark resolved** — done; record the outcome and the verified amount, so the
  portfolio reflects money you actually saved.
- **Dismiss** — not real; it stays out of your totals.

**Record outcome** is the most important habit: it's how Foresite learns what
was worth acting on, and it's how your "verified protected value" grows.

## 7. Event graph

Shows how things are connected:
- **Cascade from one field input** — several problems caused by a single note.
- **Cross-input connections** — links Foresite found between separate updates
  (like the same sub appearing in three delays).
- **Standalone events** — one-offs.

## 8. Daily brief

Your morning screen: today's priorities based on severity+age, and the week's
risk total versus what you've verified so far. Open an item straight from the
brief.

## 9. Ask My Jobs

Ask in plain language ("Which job is in the most trouble?"). Foresite answers
only from what it has actually detected in your data — it won't make things up.
Start with one of the suggested questions to see the rhythm.

## 10. Free scan

No account, no setup: paste a few recent field notes, emails, or texts and it
shows what's hiding in them (with money ranges). If you like the result, you
can save it by creating your company/project right there.

## 11. Settings (Admin)

- **Appearance** — switch the theme (or use the sun/moon button top-right) and
  change the **display currency**. Your numbers are stored neutrally, so
  switching currency just reformats what you see.
- **AI key** — paste an Anthropic API key from console.anthropic.com to power
  extraction, Ask, and the free scan. It never leaves your browser.
- **Financial assumptions** — labor rate, crew size, daily overhead, markup.
  These turn detected signals into money ranges. Leave a field blank and
  Foresite will say "insufficient information" rather than guess.
- **Reset all data** — wipes everything on this device and restarts.

## 12. About & Contact

The legal documents (Terms of Service and Privacy Policy), our contact email,
and a **feedback box** — tell us what works, what doesn't, and what to build
next. Feedback opens in your email app, so we get your message without you
handing us a database.

## 13. Installing it as an app

On a phone or desktop browser: open Foresite → browser menu → **Add to Home
Screen** / **Install app**. It opens fullscreen and works offline once loaded.
All AI features still need internet.

## 14. If something isn't working

| Problem | What it almost always means | Fix |
|---|---|---|
| "Set your AI key first" | No API key was entered | Admin → AI key → paste a key from console.anthropic.com |
| Friendly error on AI call | Key typed wrong, has no credits, or browser is offline | Check the key, check credits, check the network |
| Feed shows "no meaningful events" | The update really had nothing business-relevant, or the model was conservative | Re-phrase, add specifics (dollar amounts, dates, trades) |
| Voice button missing | Browser doesn't support it | Type instead |
| "Microphone blocked" | Browser permission denied | Allow mic access in the browser / address bar |
| Quota/rate-limit message from the model provider | Your Anthropic plan's rate limit | Wait a moment, or raise your plan limit |

## 15. Reading the numbers

- Money is always a **range** (low–high) because the input is real-world messy.
  The wider the range, the less confident Foresite is.
- **Severity** = likelihood × business impact × urgency, combined.
- Alerts older than 24 hours (critical) or 72 hours (high) get a clock icon —
  that's Foresite nudging you: the passage of time is itself data.

---

Want to talk to a human? support@foresiteapp.com — and the About screen's
feedback box opens your email to us directly.