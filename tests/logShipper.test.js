/**
 * client/log-shipper.js — the legacy LogShipper API, now a redacting shim over
 * @bevingh/telemetry. Real Express app + a fake collector over real HTTP.
 * Asserts nothing credential-shaped reaches the collector, bodies are off by
 * default, env config works, and the old API surface still behaves.
 */
const http = require('http');
const express = require('express');
const LogShipper = require('../client/log-shipper');

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjEyMyIsInR5cGUiOiJ0ZW5hbnQifQ.c2lnbmF0dXJlLXZhbHVl';
const SECRETS = [JWT, 'hunter22-pw', 'sk_live_supersecret', 'refresh-abc-123', 'jane@example.test'];

let collector;
let collectorUrl;
let batches;
let collectorStatus;

const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = (server) => new Promise((resolve) => server.close(resolve));

beforeAll(async () => {
  collector = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      if (req.url === '/api/v1/logs' && req.method === 'POST' && collectorStatus === 201) {
        batches.push({ key: req.headers['x-api-key'], logs: JSON.parse(data).logs });
      }
      res.writeHead(collectorStatus, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: collectorStatus < 300, count: 0 }));
    });
  });
  collectorUrl = await listen(collector);
});

afterAll(() => close(collector));

beforeEach(() => {
  batches = [];
  collectorStatus = 201;
  for (const k of ['TELEMETRY_COLLECTOR_URL', 'TELEMETRY_API_KEY', 'TELEMETRY_APP_ID', 'LOGGING_SERVICE_URL',
    'LOGGING_API_KEY', 'SERVICE_NAME', 'LOG_SHIPPER_ENABLED', 'ENABLE_TELEMETRY']) delete process.env[k];
});

const shipped = () => batches.flatMap((b) => b.logs);
const assertNoSecrets = (value) => {
  const s = JSON.stringify(value);
  for (const secret of SECRETS) expect(s.includes(secret)).toBe(false);
};

async function appWith(shipper) {
  const app = express();
  app.use(express.json());
  app.use(shipper.middleware());
  const router = express.Router();
  router.post('/login', (req, res) => res.json({ accessToken: JWT, refreshToken: 'refresh-abc-123' }));
  app.use('/api/v1/auth', router);
  app.get('/lookup', (req, res) => res.json({ ok: true, traceId: req.traceId }));
  const server = http.createServer(app);
  const url = await listen(server);
  return { url, server };
}

test('middleware: credentials, bodies, tokens and URL secrets never reach the collector; path is the full path', async () => {
  const shipper = new LogShipper({ serviceUrl: collectorUrl, apiKey: 'collector-key', serviceName: 'svc-test', installProcessHooks: false });
  await shipper.ready;
  const { url, server } = await appWith(shipper);
  try {
    const r = await fetch(`${url}/api/v1/auth/login?token=${JWT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${JWT}`, 'x-api-key': 'sk_live_supersecret', 'x-trace-id': 'trace-123' },
      body: JSON.stringify({ email: 'jane@example.test', password: 'hunter22-pw' }),
    });
    expect(r.status).toBe(200);
    await shipper.flush();
  } finally {
    await close(server);
    await shipper.stop();
  }

  expect(batches[0].key).toBe('collector-key');
  const [entry] = shipped();
  expect(entry.service).toBe('svc-test');
  expect(entry.path).toBe('/api/v1/auth/login');
  expect(entry.method).toBe('POST');
  expect(entry.statusCode).toBe(200);
  expect(entry.traceId).toBe('trace-123');
  expect(entry.request.headers.authorization).toBe('[REDACTED]');
  expect(entry.request.headers['x-api-key']).toBe('[REDACTED]');
  expect(entry.request.body).toBeUndefined();
  expect(entry.response).toBeUndefined();
  expect(entry.metadata.url).toMatch(/token=\[REDACTED\]/);
  assertNoSecrets(shipped());
});

test('includeBodies: bodies shipped but redacted (password, tokens) — email via redactKeys', async () => {
  const shipper = new LogShipper({
    serviceUrl: collectorUrl, apiKey: 'k', serviceName: 's', installProcessHooks: false,
    includeBodies: true, redactKeys: [/e-?mail/i],
  });
  await shipper.ready;
  const { url, server } = await appWith(shipper);
  try {
    await fetch(`${url}/api/v1/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'jane@example.test', password: 'hunter22-pw' }),
    });
    await shipper.flush();
  } finally {
    await close(server);
    await shipper.stop();
  }
  const [entry] = shipped();
  expect(entry.request.body.password).toBe('[REDACTED]');
  expect(entry.request.body.email).toBe('[REDACTED]');
  expect(entry.response.body.accessToken).toBe('[REDACTED]');
  expect(entry.response.body.refreshToken).toBe('[REDACTED]');
  assertNoSecrets(shipped());
});

test('manual log()/info(): redacted, extra fields kept in metadata, entries logged before load are not lost', async () => {
  const shipper = new LogShipper({ serviceUrl: collectorUrl, apiKey: 'k', serviceName: 's', installProcessHooks: false });
  shipper.info({ message: 'User logged in', userId: 'u1', request: { headers: { authorization: `Bearer ${JWT}` }, body: { password: 'hunter22-pw' } } });
  shipper.error({ message: `bad token ${JWT}`, error: { message: `jwt ${JWT} expired` } });
  await shipper.flush();
  await shipper.stop();

  const logs = shipped();
  expect(logs).toHaveLength(2);
  expect(logs[0].level).toBe('info');
  expect(logs[0].metadata.message).toBe('User logged in');
  expect(logs[0].metadata.userId).toBe('u1');
  expect(logs[0].request.headers.authorization).toBe('[REDACTED]');
  expect(logs[0].request.body.password).toBe('[REDACTED]');
  expect(logs[1].level).toBe('error');
  expect(typeof logs[1].traceId).toBe('string');
  assertNoSecrets(logs);
});

test('config from env (TELEMETRY_* preferred, LOGGING_* legacy names still work)', async () => {
  process.env.LOGGING_SERVICE_URL = collectorUrl;
  process.env.LOGGING_API_KEY = 'legacy-key';
  process.env.SERVICE_NAME = 'legacy-svc';
  const legacy = new LogShipper({ installProcessHooks: false });
  expect(legacy.enabled).toBe(true);
  legacy.info({ message: 'hi' });
  await legacy.flush();
  await legacy.stop();
  expect(batches[0].key).toBe('legacy-key');
  expect(batches[0].logs[0].service).toBe('legacy-svc');

  process.env.TELEMETRY_COLLECTOR_URL = collectorUrl;
  process.env.TELEMETRY_API_KEY = 'new-key';
  process.env.TELEMETRY_APP_ID = 'new-svc';
  const current = new LogShipper({ installProcessHooks: false });
  expect(current.apiKey).toBe('new-key');
  expect(current.serviceName).toBe('new-svc');
  await current.stop();
});

test('disabled or unconfigured: no-op pass-through that still sets req.traceId, never throws', async () => {
  const unconfigured = new LogShipper({ installProcessHooks: false });
  expect(unconfigured.enabled).toBe(false);
  process.env.TELEMETRY_COLLECTOR_URL = collectorUrl;
  process.env.TELEMETRY_API_KEY = 'k';
  process.env.ENABLE_TELEMETRY = 'false';
  const disabled = new LogShipper({ installProcessHooks: false });
  expect(disabled.enabled).toBe(false);

  const { url, server } = await appWith(disabled);
  try {
    const body = await (await fetch(`${url}/lookup`)).json();
    expect(typeof body.traceId).toBe('string');
    disabled.info({ message: 'x' });
    await disabled.flush();
    await disabled.stop();
  } finally {
    await close(server);
  }
  expect(batches).toHaveLength(0);
});

test('collector down: requests are unaffected and flush does not throw', async () => {
  collectorStatus = 503;
  const shipper = new LogShipper({ serviceUrl: collectorUrl, apiKey: 'k', serviceName: 's', installProcessHooks: false });
  await shipper.ready;
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  const { url, server } = await appWith(shipper);
  try {
    expect((await fetch(`${url}/lookup`)).status).toBe(200);
    await expect(shipper.flush()).resolves.toBeUndefined();
  } finally {
    await close(server);
    collectorStatus = 201;
    await shipper.stop();
    errors.mockRestore();
  }
});
