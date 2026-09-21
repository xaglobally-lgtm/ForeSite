import nodemailer from "nodemailer";

/**
 * Reuses the same EMAIL_SERVER/EMAIL_FROM Auth.js's EmailProvider already
 * requires for magic-link sign-in — one SMTP account covers both. This is
 * the concrete send call notifications.ts previously left as a TODO.
 *
 * Auth.js manages its own transport internally for sign-in emails; this
 * module is only for Foresite's own transactional email (alert notifications,
 * the daily digest) and is intentionally separate so a future switch to a
 * provider SDK (Postmark, Resend) only touches this one file.
 */
let transporter: nodemailer.Transporter | null = null;
function getTransporter() {
  if (!transporter) {
    if (!process.env.EMAIL_SERVER) {
      throw new Error("EMAIL_SERVER is not set — see .env.example. Required for any outbound email.");
    }
    transporter = nodemailer.createTransport(process.env.EMAIL_SERVER);
  }
  return transporter;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await getTransporter().sendMail({
      from: process.env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html ?? `<p>${input.text.replace(/\n/g, "<br>")}</p>`,
    });
    return { ok: true };
  } catch (err) {
    // Email failures should never crash the alert pipeline that triggered
    // them — an Alert or Notification row already exists regardless of
    // whether delivery succeeds. Log and let the caller decide what matters.
    console.error("sendEmail failed", err);
    return { ok: false, error: err instanceof Error ? err.message : "unknown error" };
  }
}
