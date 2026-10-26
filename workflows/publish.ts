import { FatalError, RetryableError, sleep } from "workflow";

// Durable publishing (Vercel Workflow), one run per version of a scheduled
// post: sleep until its time, publish it, then take metric snapshots at +1h,
// +24h and +72h for the scorecard. As with the other workflows, steps load
// their implementation with a dynamic import and only carry ids, so tokens and
// post text stay out of the event log.

/** Meta recommends checking a container's status once a minute, for no more than five minutes. */
const CONTAINER_POLL = "1m";
const CONTAINER_POLLS = 5;
const SNAPSHOT_GAPS = ["1h", "23h", "48h"] as const;

export async function publishPost(postId: string, version: number) {
  "use workflow";
  // Sleep until the post's time. Every wake re-reads the row: an edit or
  // reschedule bumps the version (and starts a new run), which stops this one.
  for (;;) {
    const plan = await planNext(postId, version);
    if (plan.action === "stop") return { outcome: plan.reason };
    if (plan.action === "publish") break;
    await sleep(new Date(plan.until));
  }
  if (!(await claim(postId, version))) return { outcome: "superseded" };

  try {
    const containerId = await prepare(postId);
    for (let poll = 0; !(await isReady(postId, containerId)); poll++) {
      if (poll >= CONTAINER_POLLS)
        throw new FatalError("Threads took too long to prepare the post. Retry in a few minutes.");
      await sleep(CONTAINER_POLL);
    }
    await publish(postId, containerId);
    await finish(postId);
  } catch (error) {
    // Fatal errors carry a message written for the user; anything else ran out of retries.
    const message = FatalError.is(error) ? error.message : "Threads didn't respond. Retry in a few minutes.";
    await fail(postId, version, message);
    return { outcome: "failed" };
  }

  for (const gap of SNAPSHOT_GAPS) {
    await sleep(gap);
    await snapshot(postId);
  }
  await score(postId);
  return { outcome: "published" };
}

// ── Steps ────────────────────────────────────────────────────────────────────

/** User-facing failures end the attempt; rate limits wait; anything else retries. */
async function classify(error: unknown): Promise<never> {
  const { PublishFailure } = await import("@/lib/publishing/publish");
  const { ThreadsApiError } = await import("@/lib/threads/errors");
  if (error instanceof PublishFailure) throw new FatalError(error.message);
  if (error instanceof ThreadsApiError && error.isRateLimited) {
    throw new RetryableError("Threads rate limit reached.", { retryAfter: "10m" });
  }
  throw error;
}

async function planNext(postId: string, version: number) {
  "use step";
  const { planPublish } = await import("@/lib/publishing/publish");
  return planPublish(postId, version);
}

async function claim(postId: string, version: number) {
  "use step";
  const { claimForPublishing } = await import("@/lib/publishing/publish");
  return claimForPublishing(postId, version);
}

async function prepare(postId: string) {
  "use step";
  const { prepareContainer } = await import("@/lib/publishing/publish");
  return prepareContainer(postId).catch(classify);
}

async function isReady(postId: string, containerId: string) {
  "use step";
  const { containerReady } = await import("@/lib/publishing/publish");
  return containerReady(postId, containerId).catch(classify);
}

async function publish(postId: string, containerId: string) {
  "use step";
  const { publishContainer } = await import("@/lib/publishing/publish");
  return publishContainer(postId, containerId).catch(classify);
}

async function finish(postId: string) {
  "use step";
  const { markPublished } = await import("@/lib/publishing/publish");
  await markPublished(postId);
}

async function fail(postId: string, version: number, message: string) {
  "use step";
  const { markFailed } = await import("@/lib/publishing/publish");
  await markFailed(postId, version, message);
}

async function snapshot(postId: string) {
  "use step";
  const { snapshotPublished } = await import("@/lib/publishing/publish");
  return snapshotPublished(postId);
}

/** With the 3-day snapshot in, the post's draft gets its score. */
async function score(postId: string) {
  "use step";
  const { scorePublished } = await import("@/lib/publishing/publish");
  await scorePublished(postId);
}
