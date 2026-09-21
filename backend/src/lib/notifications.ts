import { prisma } from "./db";
import { sendEmail } from "./email";
import type { Severity } from "./risk-engine";

/**
 * Delivery rule (spec §53):
 *   CRITICAL -> immediate (in-app + email)
 *   HIGH     -> immediate (in-app + email) — spec allows "immediate or digest";
 *               we choose immediate here since under-notifying on a real cost
 *               risk is the worse failure mode. Revisit once you have data on
 *               notification fatigue complaints.
 *   MEDIUM   -> daily digest (in-app now; email digest batched by sendDailyDigest,
 *               intended to run on a cron — see /api/cron/daily-digest)
 *   LOW      -> dashboard only, no push notification of any kind
 *
 * Every email actually goes through email.ts's sendEmail() now — a
 * Notification row's `sentAt` reflects a real send attempt, not an
 * assumption. A failed send still leaves the in-app notification intact
 * (email delivery failing should never hide an alert from the dashboard).
 */

const IMMEDIATE_SEVERITIES = new Set<Severity>(["CRITICAL", "HIGH"]);

interface NotificationRow {
  companyId: string;
  userId: string;
  alertId: string | null;
  channel: "IN_APP" | "EMAIL";
  severity: Severity;
  title: string;
  body: string;
  sentAt: Date | null;
}

export async function notifyAlert(alert: {
  id: string;
  projectId: string;
  severity: Severity;
  title: string;
  summary: string;
}) {
  if (alert.severity === "LOW") return; // dashboard-only, no notification row at all

  const project = await prisma.project.findUnique({ where: { id: alert.projectId }, select: { companyId: true } });
  if (!project) return;

  // TODO: narrow this to project members / managers+ once role-based routing
  // matters to you — notifying every active company user is the simple,
  // correct-but-noisy default for a small contractor with one shared inbox.
  const recipients = await prisma.companyUser.findMany({
    where: { companyId: project.companyId, status: "ACTIVE" },
    select: { userId: true, user: { select: { email: true } } },
  });

  const immediate = IMMEDIATE_SEVERITIES.has(alert.severity);
  const rows: NotificationRow[] = [];

  for (const r of recipients) {
    rows.push({
      companyId: project.companyId, userId: r.userId, alertId: alert.id, channel: "IN_APP",
      severity: alert.severity, title: alert.title, body: alert.summary,
      sentAt: new Date(), // in-app is always "sent" the moment it's created
    });

    if (immediate) {
      const result = await sendEmail({
        to: r.user.email,
        subject: `[Foresite] ${alert.severity}: ${alert.title}`,
        text: `${alert.summary}\n\nOpen Foresite to review and act on this alert.`,
      });
      rows.push({
        companyId: project.companyId, userId: r.userId, alertId: alert.id, channel: "EMAIL",
        severity: alert.severity, title: alert.title, body: alert.summary,
        sentAt: result.ok ? new Date() : null, // null = attempted but failed, visible for retry/audit
      });
    }
  }

  await prisma.notification.createMany({ data: rows });
}

/**
 * Daily digest for MEDIUM-severity alerts (spec §53). Call this from
 * /api/cron/daily-digest (see that route for the trigger/auth mechanism) —
 * not from the request path directly.
 */
export async function sendDailyDigest() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const mediumAlerts = await prisma.alert.findMany({
    where: { severity: "MEDIUM", status: { in: ["OPEN", "ACKNOWLEDGED"] }, createdAt: { gte: since } },
    include: { project: { select: { companyId: true, name: true } } },
  });

  const byCompany = new Map<string, typeof mediumAlerts>();
  for (const a of mediumAlerts) {
    const list = byCompany.get(a.project.companyId) ?? [];
    list.push(a);
    byCompany.set(a.project.companyId, list);
  }

  let companiesNotified = 0;
  for (const [companyId, alerts] of byCompany) {
    const recipients = await prisma.companyUser.findMany({
      where: { companyId, status: "ACTIVE" },
      select: { userId: true, user: { select: { email: true } } },
    });
    const bodyLines = alerts.map((a) => `${a.project.name}: ${a.title}`).join("\n");
    const title = `${alerts.length} medium-priority item${alerts.length === 1 ? "" : "s"} today`;

    const rows: NotificationRow[] = [];
    for (const r of recipients) {
      const result = await sendEmail({ to: r.user.email, subject: `[Foresite] Daily digest — ${title}`, text: bodyLines });
      rows.push({
        companyId, userId: r.userId, alertId: null, channel: "EMAIL", severity: "MEDIUM",
        title, body: bodyLines, sentAt: result.ok ? new Date() : null,
      });
    }
    await prisma.notification.createMany({ data: rows });
    companiesNotified++;
  }
  return { companiesNotified, alertsDigested: mediumAlerts.length };
}
