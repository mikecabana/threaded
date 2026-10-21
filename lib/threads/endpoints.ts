// Meta's hosts, overridable so end-to-end tests can point at a local mock
// (e2e/mock-meta.mjs). Production never sets the overrides.

const GRAPH_URL = "https://graph.threads.net/v1.0";
const AUTHORIZE_URL = "https://threads.net/oauth/authorize";

/** Versioned Graph API base, e.g. https://graph.threads.net/v1.0 */
export function graphUrl(): string {
  return process.env.THREADS_GRAPH_URL || GRAPH_URL;
}

/** Unversioned host for the token endpoints, e.g. https://graph.threads.net */
export function tokenHost(): string {
  return graphUrl().replace(/\/v[\d.]+\/?$/, "");
}

export function authorizeUrl(): string {
  return process.env.THREADS_AUTHORIZE_URL || AUTHORIZE_URL;
}
