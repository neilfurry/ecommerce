// k6 load test of the marketplace, run against a full production-image stack with synthetic
// data (load/README.md). Scenarios run one after another so each is measured on its own:
//
//   browse → search → product_details → cart → checkout → contention → webhook_burst
//
//   k6 run -e BASE_URL=https://shop.marketplace.test -e DATA=/load/data.json \
//          -e MOCK_WEBHOOK_SECRET=... load/k6/marketplace.js
//
// Each request is tagged with its scenario; handleSummary writes per-scenario latency and error
// figures to results/summary.json and results/summary.md.
import crypto from 'k6/crypto';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'https://shop.marketplace.test';
const API = `${BASE}/api/v1`;
const SECRET = __ENV.MOCK_WEBHOOK_SECRET || 'local-mock-webhook-secret-change-me';
const SCALE = Number(__ENV.SCALE || 1);
const RESULTS = __ENV.RESULTS_DIR || 'results';
const SESSIONS = Number(__ENV.SESSIONS || 10);
const BURST_ORDERS = Number(__ENV.BURST_ORDERS || 60);

const data = JSON.parse(open(__ENV.DATA || '../data.json'));
const products = new SharedArray('products', () => data.products);

const ordersPlaced = new Counter('orders_placed');
const contendedWins = new Counter('contended_orders_placed');
const contendedRefused = new Counter('contended_orders_refused');
const webhooksApplied = new Counter('webhooks_applied');
const webhooksDuplicate = new Counter('webhooks_duplicate');

const ok = http.expectedStatuses(200, 201);
const okOrConflict = http.expectedStatuses(200, 201, 409, 422);
const STORE = { 'X-Client-App': 'storefront' };

// Seconds into the run when each scenario starts (each runs for `duration`).
const phases = [
  ['browse', '2m'],
  ['search', '2m'],
  ['product_details', '2m'],
  ['cart', '2m'],
  ['checkout', '2m'],
  ['contention', '1m'],
  ['webhook_burst', '1m'],
];
function startOf(name) {
  let t = 0;
  for (const [n, d] of phases) {
    if (n === name) return `${t}s`;
    t += parseInt(d, 10) * 60 + 10; // 10 s gap between scenarios
  }
  throw new Error(name);
}

export const options = {
  insecureSkipTLSVerify: true,
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  setupTimeout: '10m',
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      exec: 'browse',
      startTime: startOf('browse'),
      stages: [
        { duration: '30s', target: 50 * SCALE },
        { duration: '90s', target: 50 * SCALE },
      ],
    },
    search: {
      executor: 'constant-arrival-rate',
      exec: 'search',
      startTime: startOf('search'),
      duration: '2m',
      rate: 40 * SCALE,
      timeUnit: '1s',
      preAllocatedVUs: 40 * SCALE,
      maxVUs: 200 * SCALE,
    },
    product_details: {
      executor: 'constant-arrival-rate',
      exec: 'productDetails',
      startTime: startOf('product_details'),
      duration: '2m',
      rate: 60 * SCALE,
      timeUnit: '1s',
      preAllocatedVUs: 40 * SCALE,
      maxVUs: 200 * SCALE,
    },
    cart: {
      executor: 'constant-arrival-rate',
      exec: 'cart',
      startTime: startOf('cart'),
      duration: '2m',
      rate: 20 * SCALE,
      timeUnit: '1s',
      preAllocatedVUs: 30 * SCALE,
      maxVUs: 150 * SCALE,
    },
    checkout: {
      executor: 'constant-arrival-rate',
      exec: 'checkout',
      startTime: startOf('checkout'),
      duration: '2m',
      rate: 8 * SCALE,
      timeUnit: '1s',
      preAllocatedVUs: 30 * SCALE,
      maxVUs: 150 * SCALE,
    },
    // Many customers buy the same few units at the same moment.
    contention: {
      executor: 'shared-iterations',
      exec: 'contention',
      startTime: startOf('contention'),
      vus: 50,
      iterations: 200,
      maxDuration: '1m',
    },
    // The payment provider confirms many payments at once, resending and retrying events.
    webhook_burst: {
      executor: 'shared-iterations',
      exec: 'webhookBurst',
      startTime: startOf('webhook_burst'),
      vus: 50,
      iterations: BURST_ORDERS * 4,
      maxDuration: '1m',
    },
  },
  thresholds: Object.fromEntries(
    phases.flatMap(([name]) => [
      [`http_req_duration{scenario:${name}}`, ['p(95)<2000']],
      [`http_req_failed{scenario:${name}}`, ['rate<0.01']],
      [`http_reqs{scenario:${name}}`, ['count>0']],
    ]),
  ),
};

// ---- Sessions -------------------------------------------------------------------------------

function signIn(email) {
  const jar = new http.CookieJar();
  const csrf = http.get(`${API}/auth/csrf`, { headers: STORE, jar, tags: { scenario: 'setup' } });
  const token = csrf.json('csrfToken');
  const res = http.post(`${API}/auth/sign-in`, JSON.stringify({ email, password: data.password }), {
    headers: { ...STORE, 'Content-Type': 'application/json', 'X-CSRF-Token': token },
    jar,
    tags: { scenario: 'setup' },
  });
  if (res.status !== 200) fail(`sign-in ${email}: ${res.status} ${res.body}`);
  const cookies = {};
  for (const [name, values] of Object.entries(jar.cookiesForURL(`${API}/`)))
    cookies[name] = values[0];
  const addresses = http.get(`${API}/account/addresses`, {
    headers: STORE,
    cookies,
    tags: { scenario: 'setup' },
  });
  return { email, cookies, csrf: token, addressId: addresses.json('items.0.id') };
}

function params(session, extra = {}) {
  return {
    headers: {
      ...STORE,
      'Content-Type': 'application/json',
      'X-CSRF-Token': session.csrf,
      ...(extra.headers || {}),
    },
    cookies: session.cookies,
    responseCallback: extra.responseCallback || ok,
    tags: extra.tags,
  };
}

function uuid() {
  const b = crypto.randomBytes(16);
  const h = Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function placeOrder(session, variantId, method, callback) {
  const body = { addressId: session.addressId, buyNow: { variantId, quantity: 1 } };
  const quote = http.post(
    `${API}/checkout/quote`,
    JSON.stringify(body),
    params(session, { responseCallback: callback }),
  );
  if (quote.status !== 200) return quote;
  return http.post(
    `${API}/checkout/orders`,
    JSON.stringify({
      ...body,
      paymentMethod: method,
      expectedGrandTotal: quote.json('totals.grandTotal'),
    }),
    params(session, { headers: { 'Idempotency-Key': uuid() }, responseCallback: callback }),
  );
}

export function setup() {
  // Ten sign-ins: the per-address sign-in limit (10 a minute) is a security control and is
  // not raised for the test.
  const sessions = data.customers.slice(0, SESSIONS).map(signIn);
  // Online-payment orders awaiting the provider's confirmation, for the webhook burst.
  const pending = [];
  for (let i = 0; i < BURST_ORDERS; i += 1) {
    const session = sessions[i % sessions.length];
    const product = data.products[(i * 13) % data.products.length];
    const res = placeOrder(session, product.variantId, 'GCASH', ok);
    if (res.status !== 201) fail(`burst order: ${res.status} ${res.body}`);
    const attempt = res.json('payment.attempts.0');
    pending.push({
      sessionId: attempt.checkoutUrl.split('/').pop(),
      reference: attempt.reference,
      amount: attempt.amount,
    });
  }
  return { sessions, pending };
}

// ---- Scenarios ------------------------------------------------------------------------------

export function browse() {
  const page = 1 + Math.floor(Math.random() * 20);
  const res = http.batch([
    ['GET', `${API}/storefront/home`, null, { headers: STORE }],
    ['GET', `${API}/categories`, null, { headers: STORE }],
    [
      'GET',
      `${API}/catalog/products?page=${page}&pageSize=24&sort=newest`,
      null,
      { headers: STORE },
    ],
  ]);
  check(res, { 'browse pages load': (r) => r.every((x) => x.status === 200) });
  sleep(1 + Math.random() * 2);
}

export function search() {
  const term = data.searchTerms[Math.floor(Math.random() * data.searchTerms.length)];
  const res = http.get(`${API}/catalog/products?q=${encodeURIComponent(term)}&pageSize=24`, {
    headers: STORE,
  });
  check(res, { 'search 200': (r) => r.status === 200 });
  http.get(`${API}/catalog/suggest?q=${encodeURIComponent(term.slice(0, 3))}`, { headers: STORE });
}

export function productDetails() {
  const p = products[Math.floor(Math.random() * products.length)];
  const res = http.get(`${API}/catalog/products/${p.id}`, { headers: STORE });
  check(res, { 'product 200': (r) => r.status === 200 });
  http.get(`${API}/catalog/products/${p.id}/reviews`, { headers: STORE });
}

export function cart(shared) {
  const session = shared.sessions[exec.scenario.iterationInTest % shared.sessions.length];
  const p = products[Math.floor(Math.random() * products.length)];
  // A guest's browser cart priced by the server, then the signed-in cart: add, change, remove.
  http.post(
    `${API}/cart/preview`,
    JSON.stringify({ items: [{ variantId: p.variantId, quantity: 2 }] }),
    { headers: { ...STORE, 'Content-Type': 'application/json' } },
  );
  const added = http.post(
    `${API}/cart/items`,
    JSON.stringify({ variantId: p.variantId, quantity: 1 }),
    params(session),
  );
  const line = (added.json('groups') || [])
    .flatMap((g) => g.lines || [])
    .find((l) => l.variantId === p.variantId);
  if (line) {
    http.patch(`${API}/cart/items/${line.id}`, JSON.stringify({ quantity: 2 }), params(session));
    http.del(`${API}/cart/items/${line.id}`, null, params(session));
  }
  check(added, { 'cart add 200': (r) => r.status === 200 });
}

export function checkout(shared) {
  const session = shared.sessions[exec.scenario.iterationInTest % shared.sessions.length];
  const p = products[Math.floor(Math.random() * products.length)];
  const res = placeOrder(session, p.variantId, 'COD', ok);
  if (check(res, { 'order placed': (r) => r.status === 201 })) ordersPlaced.add(1);
}

export function contention(shared) {
  const session = shared.sessions[exec.scenario.iterationInTest % shared.sessions.length];
  const res = placeOrder(session, data.contended.variantId, 'COD', okOrConflict);
  if (res.status === 201) contendedWins.add(1);
  else if (res.status === 409 || res.status === 422) contendedRefused.add(1);
  check(res, { 'placed or refused (never an error)': (r) => [201, 409, 422].includes(r.status) });
}

export function webhookBurst(shared) {
  // Four deliveries per pending payment: three distinct provider events (resends) and one
  // retry of the first, all arriving concurrently from 50 connections.
  const i = exec.scenario.iterationInTest;
  const order = shared.pending[Math.floor(i / 4) % shared.pending.length];
  const copy = i % 4;
  const event = {
    id: `evt_load_${order.reference}_${copy === 3 ? 0 : copy}`,
    type: 'payment.paid',
    livemode: false,
    data: {
      sessionId: order.sessionId,
      paymentReference: order.reference,
      paymentId: `pay_load_${order.reference}`,
      amount: order.amount,
    },
  };
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const signature = crypto.hmac('sha256', SECRET, `${t}.${body}`, 'hex');
  const res = http.post(`${API}/payments/webhooks/mock`, body, {
    headers: { 'Content-Type': 'application/json', 'x-mock-signature': `t=${t},v1=${signature}` },
  });
  if (check(res, { 'webhook accepted': (r) => r.status === 200 })) {
    if (res.json('duplicate')) webhooksDuplicate.add(1);
    else webhooksApplied.add(1);
  }
}

// ---- Report ---------------------------------------------------------------------------------

function metric(data, name) {
  return data.metrics[name] ? data.metrics[name].values : null;
}

export function handleSummary(summary) {
  // Scenarios run one after another, so the request rate is over the scenario's own window
  // (k6's own "rate" divides by the whole run). Contention and the webhook burst finish
  // before their window ends, so their rate is a lower bound.
  const rows = phases.map(([name, duration]) => {
    const d = metric(summary, `http_req_duration{scenario:${name}}`) || {};
    const f = metric(summary, `http_req_failed{scenario:${name}}`) || {};
    const n = metric(summary, `http_reqs{scenario:${name}}`) || {};
    return {
      scenario: name,
      requests: n.count || 0,
      rps: Math.round(((n.count || 0) / (parseInt(duration, 10) * 60)) * 10) / 10,
      p50_ms: Math.round(d.med || 0),
      p95_ms: Math.round(d['p(95)'] || 0),
      p99_ms: Math.round(d['p(99)'] || 0),
      max_ms: Math.round(d.max || 0),
      error_rate: Math.round((f.rate || 0) * 10000) / 100,
    };
  });
  const counters = Object.fromEntries(
    [
      'orders_placed',
      'contended_orders_placed',
      'contended_orders_refused',
      'webhooks_applied',
      'webhooks_duplicate',
    ].map((k) => [k, (metric(summary, k) || {}).count || 0]),
  );
  const thresholdsFailed = Object.entries(summary.metrics)
    .filter(([, m]) => m.thresholds && Object.values(m.thresholds).some((t) => !t.ok))
    .map(([k]) => k);
  const md = [
    '| Scenario | Requests | Req/s (scenario window) | p50 ms | p95 ms | p99 ms | Max ms | Errors % |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map(
      (r) =>
        `| ${r.scenario} | ${r.requests} | ${r.rps} | ${r.p50_ms} | ${r.p95_ms} | ${r.p99_ms} | ${r.max_ms} | ${r.error_rate} |`,
    ),
    '',
    `Counters: ${JSON.stringify(counters)}`,
    `Thresholds failed: ${thresholdsFailed.length ? thresholdsFailed.join(', ') : 'none'}`,
  ].join('\n');
  const json = JSON.stringify(
    { rows, counters, thresholdsFailed, contendedStock: data.contendedStock },
    null,
    2,
  );
  return {
    stdout: `\n${md}\n`,
    [`${RESULTS}/summary.json`]: json,
    [`${RESULTS}/summary.md`]: md,
  };
}
