import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

// What leaves for Sentry (docs/PLAN.md §13). Error reports keep their stack
// traces and routes, never secrets or what people wrote: Threads tokens ride
// in Graph API query strings, request bodies carry post text and drafts, and
// Postgres errors can quote a failing row.

const SECRET_PARAMS =
  /([?&](?:access_token|client_secret|fb_exchange_token|code|token|api_key|key|signature|state)=)[^&#\s"']+/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
// Gateway and Stripe keys, and our own signed tokens.
const KEYS = /\b(?:vck|sk_(?:live|test)|rk_(?:live|test)|whsec|re)_[A-Za-z0-9_]{8,}/g;
const FAILING_ROW = /(Failing row contains )\(.*\)/gs;
const KEY_DETAIL = /(Key \([^)]*\)=)\(.*?\)/g;

/** A message or URL with secrets and quoted rows taken out. */
export function scrubText(text: string): string {
  return text
    .replace(SECRET_PARAMS, "$1[Filtered]")
    .replace(BEARER, "$1 [Filtered]")
    .replace(KEYS, "[Filtered]")
    .replace(FAILING_ROW, "$1([Filtered])")
    .replace(KEY_DETAIL, "$1([Filtered])");
}

const scrubData = (data: Record<string, unknown> | undefined) =>
  data &&
  Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, typeof value === "string" ? scrubText(value) : value]),
  );

/** Breadcrumbs keep navigation and HTTP calls, with their URLs scrubbed; console output is dropped (it can quote posts). */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === "console") return null;
  return {
    ...breadcrumb,
    message: breadcrumb.message && scrubText(breadcrumb.message),
    data: scrubData(breadcrumb.data),
  };
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const { request } = event;
  return {
    ...event,
    user: undefined,
    message: event.message && scrubText(event.message),
    request: request && {
      method: request.method,
      url: request.url && scrubText(request.url),
      query_string: typeof request.query_string === "string" ? scrubText(request.query_string) : undefined,
    },
    exception: event.exception && {
      ...event.exception,
      values: event.exception.values?.map((value) => ({ ...value, value: value.value && scrubText(value.value) })),
    },
    breadcrumbs: event.breadcrumbs?.flatMap((crumb) => scrubBreadcrumb(crumb) ?? []),
  };
}

/** Options shared by the browser, Node and edge SDKs. */
export function sentryOptions(dsn: string, environment: string | undefined) {
  return {
    dsn,
    environment: environment ?? "development",
    // Errors only: no performance tracing, no session replay, no IP addresses or cookies.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
