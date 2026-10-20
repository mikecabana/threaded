/** An error response from graph.threads.net (Graph API error envelope). */
export class ThreadsApiError extends Error {
  readonly status: number;
  readonly code: number | undefined;
  readonly subcode: number | undefined;
  readonly type: string | undefined;
  readonly traceId: string | undefined;

  constructor(
    message: string,
    init: { status: number; code?: number; subcode?: number; type?: string; traceId?: string },
  ) {
    super(message);
    this.name = "ThreadsApiError";
    this.status = init.status;
    this.code = init.code;
    this.subcode = init.subcode;
    this.type = init.type;
    this.traceId = init.traceId;
  }

  /** The token is invalid, expired or revoked: the user has to reconnect. */
  get isAuthError(): boolean {
    return this.status === 401 || this.code === 190 || this.type === "OAuthException";
  }

  /** Graph API throttling codes; back off and retry later. */
  get isRateLimited(): boolean {
    return this.status === 429 || [4, 17, 32, 613].includes(this.code ?? -1);
  }
}
