import { prisma } from "./db";

/**
 * Spec §64's full event list, for reference (not all are wired up at every
 * call site yet — add track() calls as you build out each flow):
 *
 *   Acquisition:  signup_started, signup_completed, project_created
 *   Activation:   input_submitted, input_processed
 *   Intelligence: event_created, alert_created, alert_viewed, alert_useful,
 *                 alert_wrong, alert_already_handled, alert_dismissed
 *   Value:        action_created, action_completed, outcome_recorded
 *   Free scan:    free_scan_started, free_scan_completed
 *   Billing:      trial_started, subscription_started, subscription_upgraded,
 *                 subscription_cancelled
 *
 * Fire-and-forget by design: a failed analytics write should never break the
 * user-facing action that triggered it. Swap the body of track() for a
 * PostHog/Segment/Amplitude call later — every call site stays the same.
 */
export function track(name: string, properties?: { companyId?: string; userId?: string; [key: string]: unknown }) {
  const { companyId, userId, ...rest } = properties ?? {};
  prisma.analyticsEvent
    .create({ data: { name, companyId: companyId ?? null, userId: userId ?? null, properties: rest } })
    .catch((err) => console.error(`analytics track("${name}") failed`, err));
}
