// A tiny stand-in for Meta's Threads OAuth and Graph endpoints, used by the
// end-to-end tests (THREADS_GRAPH_URL / THREADS_AUTHORIZE_URL point here).
// It approves every sign-in as the same fake account, and publishes posts:
// a post whose text contains "#fail" gets a container Threads can't prepare.
import { createServer } from "node:http";

const port = Number(process.env.MOCK_META_PORT ?? 3999);

export const MOCK_PROFILE = {
  id: "9001",
  username: "mock.user",
  name: "Mock Person",
  threads_biography: "Testing Threaded end to end.",
  is_verified: false,
};

const DAY_MS = 86_400_000;
const TEXTS = [
  ["What's the one tool you couldn't work without?", 3.2],
  ["Hot take: most meetings should be a document.", 1.9],
  ["Shipped a small thing today. Small things add up.", 1.1],
  ["Three habits that doubled my output:\n\n1. Mornings offline\n2. One task list\n3. Walks", 1.4],
  ["Which do you prefer: async updates or a weekly call?", 2.8],
  ["Learned the hard way: write the README first.", 1.2],
  ["What did you finish this week? Brag a little.", 3.0],
  ["The best feedback I got this year was one sentence long.", 1.0],
  ["Unpopular opinion: dark mode is overrated.", 2.1],
  ["Tiny tip: name your branches after the problem, not the fix.", 1.3],
  ["Where do you get your best ideas?", 2.6],
  ["Six months of building in public, in one chart.", 1.6],
];

/** A dozen posts over the last ~40 days, with replies favouring questions. */
function mockPosts(now = Date.now()) {
  return TEXTS.map(([text, replyBoost], i) => {
    const views = 600 + ((i * 397) % 900);
    return {
      id: `mock-post-${i + 1}`,
      text,
      timestamp: new Date(now - (2 + i * 3.3) * DAY_MS - i * 3_600_000).toISOString(),
      media_type: "TEXT_POST",
      permalink: `https://www.threads.net/@mock.user/post/MOCK${i + 1}`,
      insights: {
        views,
        likes: Math.round(views * 0.05),
        replies: Math.round(views * 0.006 * replyBoost),
        reposts: Math.round(views * 0.004),
        quotes: Math.round(views * 0.001),
        shares: Math.round(views * 0.002),
      },
    };
  });
}

/** Posts published through the mock, newest last; they show up in the post list too. */
const published = [];
const containers = new Map();

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
  if (url.pathname.startsWith("/v1.0/") && token !== "long-token") {
    return json(res, 401, { error: { message: "bad token", type: "OAuthException", code: 190 } });
  }
  if (url.pathname === "/v1.0/me/threads" && req.method === "POST") {
    const id = `mock-container-${containers.size + 1}`;
    containers.set(id, { text: url.searchParams.get("text") ?? "", topicTag: url.searchParams.get("topic_tag") });
    return json(res, 200, { id });
  }
  if (url.pathname === "/v1.0/me/threads_publish" && req.method === "POST") {
    const container = containers.get(url.searchParams.get("creation_id"));
    if (!container) return json(res, 400, { error: { message: "Invalid creation_id", code: 100 } });
    const id = `mock-media-${published.length + 1}`;
    published.push({
      id,
      text: container.text,
      timestamp: new Date().toISOString(),
      media_type: "TEXT_POST",
      permalink: `https://www.threads.net/@mock.user/post/${id.toUpperCase()}`,
      insights: { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0, shares: 0 },
    });
    return json(res, 200, { id });
  }
  if (url.pathname === "/v1.0/me/threads_publishing_limit") {
    return json(res, 200, {
      data: [{ quota_usage: published.length, config: { quota_total: 250, quota_duration: 86400 } }],
    });
  }
  const container = containers.get(url.pathname.slice("/v1.0/".length));
  if (container) {
    const failing = container.text.includes("#fail");
    return json(res, 200, {
      id: url.pathname.slice("/v1.0/".length),
      status: failing ? "ERROR" : "FINISHED",
      error_message: failing ? "The post couldn't be processed" : null,
    });
  }
  const media = published.find((p) => url.pathname === `/v1.0/${p.id}`);
  if (media) return json(res, 200, { id: media.id, permalink: media.permalink, timestamp: media.timestamp });

  if (url.pathname === "/v1.0/me/threads") {
    const since = Number(url.searchParams.get("since") ?? 0) * 1000;
    const posts = [...published, ...mockPosts()].filter((p) => Date.parse(p.timestamp) >= since);
    return json(res, 200, {
      data: posts.map(({ insights, ...post }) => post),
      paging: {},
    });
  }
  const insights = url.pathname.match(/^\/v1\.0\/([^/]+)\/insights$/);
  if (insights) {
    const post = [...published, ...mockPosts()].find((p) => p.id === insights[1]);
    if (!post) return json(res, 400, { error: { message: "Unsupported get request", code: 100 } });
    return json(res, 200, {
      data: Object.entries(post.insights).map(([name, value]) => ({ name, values: [{ value }] })),
    });
  }
  if (url.pathname === "/v1.0/me/threads_insights") {
    const since = Number(url.searchParams.get("since")) * 1000;
    const day = Math.floor((Date.now() - since) / DAY_MS);
    return json(res, 200, {
      data: [
        {
          name: "views",
          values: [{ value: 300 + ((day * 131) % 400), end_time: new Date(since + DAY_MS).toISOString() }],
        },
        { name: "likes", total_value: { value: 20 + (day % 7) } },
        { name: "replies", total_value: { value: 4 + (day % 3) } },
        { name: "reposts", total_value: { value: 2 } },
        { name: "quotes", total_value: { value: 1 } },
        { name: "clicks", total_value: { value: 5 } },
        { name: "followers_count", total_value: { value: 1234 } },
      ],
    });
  }
  if (url.pathname === "/health") return json(res, 200, { ok: true });
  return json(res, 404, { error: { message: `mock has no route for ${url.pathname}`, code: 100 } });
});

server.listen(port, () => console.log(`mock Meta listening on ${port}`));
