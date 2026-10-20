// Cookie names shared by the proxy and server code. Kept free of server-only
// imports so proxy.ts can use them.

/** Which demo persona the visitor is exploring (no real account involved). */
export const DEMO_COOKIE = "threaded_demo";

/** Real sessions (Phase 1): random 256-bit id pointing at a sessions row. */
export const SESSION_COOKIE = "threaded_session";
