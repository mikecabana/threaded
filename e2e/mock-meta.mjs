// A tiny stand-in for Meta's Threads OAuth and Graph endpoints, used by the
// end-to-end tests (THREADS_GRAPH_URL / THREADS_AUTHORIZE_URL point here).
// It approves every sign-in as the same fake account.
import { createServer } from "node:http";

const port = Number(process.env.MOCK_META_PORT ?? 3999);

export const MOCK_PROFILE = {
  id: "9001",
  username: "mock.user",
  name: "Mock Person",
  threads_biography: "Testing Threaded end to end.",
  is_verified: false,
};

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readForm(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return new URLSearchParams(raw);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const token = url.searchParams.get("access_token");

  if (url.pathname === "/oauth/authorize") {
    // Simulates the person pressing "Allow" on Meta's consent screen.
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", "mock-code");
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }
  if (url.pathname === "/oauth/access_token" && req.method === "POST") {
    const form = await readForm(req);
    if (form.get("code") !== "mock-code") return json(res, 400, { error: { message: "bad code", code: 100 } });
    return json(res, 200, { access_token: "short-token", user_id: Number(MOCK_PROFILE.id) });
  }
  if (url.pathname === "/access_token") {
    if (token !== "short-token") return json(res, 400, { error: { message: "bad token", code: 190 } });
    return json(res, 200, { access_token: "long-token", token_type: "bearer", expires_in: 5_184_000 });
  }
  if (url.pathname === "/v1.0/me") {
    if (token !== "long-token")
      return json(res, 401, { error: { message: "bad token", type: "OAuthException", code: 190 } });
    return json(res, 200, MOCK_PROFILE);
  }
  if (url.pathname === "/health") return json(res, 200, { ok: true });
  return json(res, 404, { error: { message: `mock has no route for ${url.pathname}`, code: 100 } });
});

server.listen(port, () => console.log(`mock Meta listening on ${port}`));
