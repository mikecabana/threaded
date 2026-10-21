// A small, stateful stand-in for the parts of Stripe that Threaded uses
// (customers, hosted Checkout, subscriptions, invoices, the billing portal and
// signed webhooks) plus the AI Gateway's credits endpoint. Integration tests
// start it in-process; the end-to-end tests run it as a web server
// (STRIPE_API_URL and AI_GATEWAY_BASE_URL point here).
//
// Hosted Checkout is a plain HTML page at /pay/:id with buttons for each
// outcome. Saving the "declining" card mimics Stripe's 4000 0000 0000 0341
// test card: it saves fine, then every charge is declined.
import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const DAY_S = 86_400;
const newId = (prefix) => `${prefix}_${randomBytes(8).toString("hex")}`;
const nowS = () => Math.floor(Date.now() / 1000);

/** Parses Stripe's form encoding (`a[b][0][c]=1`) into nested objects and arrays. */
export function parseStripeForm(raw) {
  const out = {};
  for (const [rawKey, value] of new URLSearchParams(raw)) {
    const path = rawKey.replace(/\]/g, "").split("[");
    let node = out;
    path.forEach((part, i) => {
      const last = i === path.length - 1;
      const nextIsIndex = !last && /^\d+$/.test(path[i + 1]);
      if (last) node[part] = value;
      else node = node[part] ??= nextIsIndex ? [] : {};
    });
  }
  return out;
}

export function signPayload(payload, secret, timestamp = nowS()) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

const stripeError = (status, type, message, extra = {}) => ({ status, body: { error: { type, message, ...extra } } });
const notFound = (what, id) => stripeError(404, "invalid_request_error", `No such ${what}: '${id}'`);

export function createMockBilling({ webhookUrl, webhookSecret, publicUrl } = {}) {
  const state = {
    customers: new Map(),
    sessions: new Map(),
    subscriptions: new Map(),
    setupIntents: new Map(),
    paymentMethods: new Map(),
    invoices: new Map(),
    idempotency: new Map(),
    /** Every event sent (or that would have been sent), newest last. */
    events: [],
  };
  let baseUrl = publicUrl ?? "";

  async function emit(type, object) {
    const event = { id: newId("evt"), object: "event", type, created: nowS(), livemode: false, data: { object } };
    state.events.push(event);
    if (!webhookUrl || !webhookSecret) return;
    const payload = JSON.stringify(event);
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "stripe-signature": signPayload(payload, webhookSecret) },
        body: payload,
      });
    } catch (error) {
      console.error(`mock-billing: webhook ${type} failed`, error);
    }
  }

  function customerView(customer, expand = []) {
    const pm = customer.invoice_settings.default_payment_method;
    const expanded = expand.includes("invoice_settings.default_payment_method") && pm;
    return {
      ...customer,
      invoice_settings: {
        ...customer.invoice_settings,
        default_payment_method: expanded ? (state.paymentMethods.get(pm) ?? null) : pm,
      },
    };
  }

  function createPaymentMethod(customer, declines) {
    const pm = {
      id: newId("pm"),
      object: "payment_method",
      type: "card",
      customer,
      card: { brand: "visa", last4: declines ? "0341" : "4242", exp_month: 12, exp_year: 2030 },
      declines,
    };
    state.paymentMethods.set(pm.id, pm);
    return pm;
  }

  /** Completes a hosted Checkout session the way a customer would. outcome: "pay" | "decline-card". */
  async function completeSession(id, outcome = "pay") {
    const session = state.sessions.get(id);
    if (session?.status !== "open") return session;
    session.status = "complete";
    if (session.mode === "payment") {
      session.payment_status = "paid";
      session.payment_intent = newId("pi");
    } else if (session.mode === "subscription") {
      const subscription = {
        id: newId("sub"),
        object: "subscription",
        customer: session.customer,
        status: "active",
        cancel_at_period_end: false,
        cancel_at: null,
        metadata: session.subscription_data?.metadata ?? {},
        items: { object: "list", data: [{ id: newId("si"), current_period_end: nowS() + 30 * DAY_S }] },
      };
      state.subscriptions.set(subscription.id, subscription);
      session.subscription = subscription.id;
      session.payment_status = "paid";
      await emit("customer.subscription.created", subscription);
    } else if (session.mode === "setup") {
      const pm = createPaymentMethod(session.customer, outcome === "decline-card");
      const setupIntent = { id: newId("seti"), object: "setup_intent", payment_method: pm.id, status: "succeeded" };
      state.setupIntents.set(setupIntent.id, setupIntent);
      session.setup_intent = setupIntent.id;
      session.payment_status = "no_payment_required";
    }
    await emit("checkout.session.completed", session);
    return session;
  }

  async function setSubscription(id, changes, type = "customer.subscription.updated") {
    const subscription = state.subscriptions.get(id);
    if (!subscription) return null;
    Object.assign(subscription, changes);
    subscription.cancel_at = subscription.cancel_at_period_end ? subscription.items.data[0].current_period_end : null;
    await emit(type, subscription);
    return subscription;
  }

  /** Stripe API routes: [method, pattern, handler(params, body, query) → {status?, body}]. */
  const routes = [
    [
      "POST",
      /^\/v1\/customers$/,
      (_, body) => {
        const customer = {
          id: newId("cus"),
          object: "customer",
          name: body.name ?? null,
          metadata: body.metadata ?? {},
          invoice_settings: { default_payment_method: null },
        };
        state.customers.set(customer.id, customer);
        return { body: customer };
      },
    ],
    [
      "GET",
      /^\/v1\/customers\/([^/]+)$/,
      ([id], _, query) => {
        const customer = state.customers.get(id);
        return customer ? { body: customerView(customer, query.expand ?? []) } : notFound("customer", id);
      },
    ],
    [
      "POST",
      /^\/v1\/customers\/([^/]+)$/,
      ([id], body) => {
        const customer = state.customers.get(id);
        if (!customer) return notFound("customer", id);
        if (body.invoice_settings?.default_payment_method) {
          customer.invoice_settings.default_payment_method = body.invoice_settings.default_payment_method;
        }
        return { body: customerView(customer) };
      },
    ],
    [
      "POST",
      /^\/v1\/checkout\/sessions$/,
      (_, body) => {
        if (!state.customers.has(body.customer)) return notFound("customer", body.customer);
        const id = newId("cs_test");
        const subtotal = (body.line_items ?? []).reduce(
          (sum, item) => sum + Number(item.price_data?.unit_amount ?? 0) * Number(item.quantity ?? 1),
          0,
        );
        const session = {
          id,
          object: "checkout.session",
          mode: body.mode,
          status: "open",
          payment_status: "unpaid",
          customer: body.customer,
          client_reference_id: body.client_reference_id ?? null,
          metadata: body.metadata ?? {},
          subscription_data: body.subscription_data,
          line_items: body.line_items ?? [],
          amount_subtotal: subtotal,
          amount_total: subtotal,
          subscription: null,
          setup_intent: null,
          payment_intent: null,
          success_url: body.success_url,
          cancel_url: body.cancel_url,
          url: `${baseUrl}/pay/${id}`,
        };
        state.sessions.set(id, session);
        return { body: session };
      },
    ],
    [
      "GET",
      /^\/v1\/checkout\/sessions\/([^/]+)$/,
      ([id]) => {
        const session = state.sessions.get(id);
        return session ? { body: session } : notFound("checkout.session", id);
      },
    ],
    [
      "GET",
      /^\/v1\/setup_intents\/([^/]+)$/,
      ([id]) => {
        const setupIntent = state.setupIntents.get(id);
        return setupIntent ? { body: setupIntent } : notFound("setup_intent", id);
      },
    ],
    [
      "GET",
      /^\/v1\/subscriptions\/([^/]+)$/,
      ([id]) => {
        const subscription = state.subscriptions.get(id);
        return subscription ? { body: subscription } : notFound("subscription", id);
      },
    ],
    [
      "POST",
      /^\/v1\/subscriptions\/([^/]+)$/,
      async ([id], body) => {
        if (!state.subscriptions.has(id)) return notFound("subscription", id);
        const changes = {};
        if (body.cancel_at_period_end !== undefined)
          changes.cancel_at_period_end = body.cancel_at_period_end === "true";
        return { body: await setSubscription(id, changes) };
      },
    ],
    [
      "DELETE",
      /^\/v1\/subscriptions\/([^/]+)$/,
      async ([id]) => {
        if (!state.subscriptions.has(id)) return notFound("subscription", id);
        return { body: await setSubscription(id, { status: "canceled" }, "customer.subscription.deleted") };
      },
    ],
    [
      "POST",
      /^\/v1\/invoices$/,
      (_, body) => {
        if (!state.customers.has(body.customer)) return notFound("customer", body.customer);
        const invoice = {
          id: newId("in"),
          object: "invoice",
          customer: body.customer,
          status: "draft",
          metadata: body.metadata ?? {},
          description: body.description ?? null,
          lines: [],
          subtotal: 0,
          amount_paid: 0,
        };
        state.invoices.set(invoice.id, invoice);
        return { body: invoice };
      },
    ],
    [
      "GET",
      /^\/v1\/invoices\/([^/]+)$/,
      ([id]) => {
        const invoice = state.invoices.get(id);
        return invoice ? { body: invoice } : notFound("invoice", id);
      },
    ],
    [
      "POST",
      /^\/v1\/invoiceitems$/,
      (_, body) => {
        const invoice = state.invoices.get(body.invoice);
        if (!invoice) return notFound("invoice", body.invoice);
        const item = { id: newId("ii"), object: "invoiceitem", amount: Number(body.amount), invoice: invoice.id };
        invoice.lines.push(item);
        invoice.subtotal += item.amount;
        return { body: item };
      },
    ],
    [
      "POST",
      /^\/v1\/invoices\/([^/]+)\/finalize$/,
      ([id]) => {
        const invoice = state.invoices.get(id);
        if (!invoice) return notFound("invoice", id);
        if (invoice.status === "draft") invoice.status = "open";
        return { body: invoice };
      },
    ],
    [
      "POST",
      /^\/v1\/invoices\/([^/]+)\/pay$/,
      async ([id]) => {
        const invoice = state.invoices.get(id);
        if (!invoice) return notFound("invoice", id);
        const customer = state.customers.get(invoice.customer);
        const pm = state.paymentMethods.get(customer?.invoice_settings.default_payment_method);
        if (!pm) return stripeError(400, "invalid_request_error", "This customer has no attached payment source.");
        if (pm.declines) {
          return stripeError(402, "card_error", "Your card was declined.", {
            code: "card_declined",
            decline_code: "generic_decline",
          });
        }
        invoice.status = "paid";
        invoice.amount_paid = invoice.subtotal;
        await emit("invoice.paid", invoice);
        return { body: invoice };
      },
    ],
    [
      "POST",
      /^\/v1\/invoices\/([^/]+)\/void$/,
      ([id]) => {
        const invoice = state.invoices.get(id);
        if (!invoice) return notFound("invoice", id);
        invoice.status = "void";
        return { body: invoice };
      },
    ],
    [
      "POST",
      /^\/v1\/billing_portal\/sessions$/,
      (_, body) => ({
        body: {
          id: newId("bps"),
          object: "billing_portal.session",
          url: `${baseUrl}/portal?return=${encodeURIComponent(body.return_url)}`,
        },
      }),
    ],
  ];

  function checkoutPage(session) {
    const amount = `$${(session.amount_subtotal / 100).toFixed(2)}`;
    const buttons =
      session.mode === "setup"
        ? `<button name="outcome" value="pay">Save card</button>
           <button name="outcome" value="decline-card">Save a card that declines</button>`
        : `<button name="outcome" value="pay">${session.mode === "subscription" ? "Subscribe" : "Pay"} ${amount}</button>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Mock Checkout</title></head>
      <body><main><h1>Mock Checkout</h1><p>${session.mode} · ${amount}</p>
      <form method="post">${buttons}</form>
      <a href="${session.cancel_url}">Cancel</a></main></body></html>`;
  }

  async function readBody(req) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    return raw;
  }

  function send(res, status, body, headers = { "content-type": "application/json" }) {
    res.writeHead(status, headers);
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/health") return send(res, 200, { ok: true });

      // AI Gateway: GET /v1/credits with a Bearer key. Keys containing "bad" are rejected.
      if (url.pathname === "/v1/credits") {
        const key = (req.headers.authorization ?? "").replace(/^Bearer /, "");
        if (!key.startsWith("vck_") || key.includes("bad")) {
          return send(res, 401, { error: { type: "authentication_error", message: "Invalid API key" } });
        }
        return send(res, 200, { balance: "12.50", total_used: "3.10" });
      }

      const pay = url.pathname.match(/^\/pay\/([^/]+)$/);
      if (pay) {
        const session = state.sessions.get(pay[1]);
        if (!session) return send(res, 404, "Unknown session", { "content-type": "text/plain" });
        if (req.method === "GET") return send(res, 200, checkoutPage(session), { "content-type": "text/html" });
        const form = new URLSearchParams(await readBody(req));
        await completeSession(session.id, form.get("outcome") ?? "pay");
        return send(res, 303, "", { location: session.success_url.replace("{CHECKOUT_SESSION_ID}", session.id) });
      }
      if (url.pathname === "/portal") {
        const back = url.searchParams.get("return") ?? "/";
        return send(res, 200, `<!doctype html><title>Mock portal</title><a href="${back}">Return to Threaded</a>`, {
          "content-type": "text/html",
        });
      }
      // Test control: end a subscription as if it lapsed.
      const end = url.pathname.match(/^\/__control\/subscriptions\/([^/]+)\/end$/);
      if (end && req.method === "POST") {
        const ended = await setSubscription(end[1], { status: "canceled" }, "customer.subscription.deleted");
        return send(res, ended ? 200 : 404, ended ?? { error: "not found" });
      }

      const raw = req.method === "POST" ? await readBody(req) : "";
      const body = parseStripeForm(raw);
      const query = parseStripeForm(url.search.slice(1));
      const key = req.headers["idempotency-key"];
      const cacheKey = key && req.method === "POST" ? `${key}:${url.pathname}` : null;
      if (cacheKey && state.idempotency.has(cacheKey)) {
        const cached = state.idempotency.get(cacheKey);
        return send(res, cached.status, cached.body);
      }
      for (const [method, pattern, handler] of routes) {
        const match = req.method === method && url.pathname.match(pattern);
        if (!match) continue;
        const result = await handler(match.slice(1), body, query);
        const status = result.status ?? 200;
        if (cacheKey) state.idempotency.set(cacheKey, { status, body: result.body });
        return send(res, status, result.body);
      }
      return send(res, 404, {
        error: { type: "invalid_request_error", message: `Unrecognized ${req.method} ${url.pathname}` },
      });
    } catch (error) {
      console.error("mock-billing error", error);
      return send(res, 500, { error: { type: "api_error", message: String(error) } });
    }
  });

  return {
    server,
    state,
    completeSession,
    setSubscription,
    /** Listens on `port` (0 = any free port) and resolves with the base URL. */
    listen(port = 0) {
      return new Promise((resolve) => {
        server.listen(port, () => {
          const address = server.address();
          baseUrl = publicUrl ?? `http://localhost:${typeof address === "object" && address ? address.port : port}`;
          resolve(baseUrl);
        });
      });
    },
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.MOCK_BILLING_PORT ?? 3998);
  const mock = createMockBilling({
    webhookUrl: process.env.MOCK_BILLING_WEBHOOK_URL,
    webhookSecret: process.env.MOCK_BILLING_WEBHOOK_SECRET,
  });
  mock.listen(port).then((url) => console.log(`Mock billing listening on ${url}`));
}
