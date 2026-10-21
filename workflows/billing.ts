// Durable auto-recharge (Vercel Workflow). As with the sync workflows, the step
// loads its implementation with a dynamic import so Stripe and the database
// stay out of the workflow sandbox bundle. A step that throws (a Stripe outage)
// is retried; the Stripe calls are idempotent per claim, so retries are safe.

/** Buys the workspace's auto-recharge pack with its saved card. `attemptAt` is the claim from claimAutoRecharge(). */
export async function autoRecharge(workspaceId: string, attemptAt: string) {
  "use workflow";
  return chargeSavedCard(workspaceId, attemptAt);
}

async function chargeSavedCard(workspaceId: string, attemptAt: string) {
  "use step";
  const { runAutoRecharge } = await import("@/lib/billing/auto-recharge");
  return runAutoRecharge(workspaceId, attemptAt);
}
