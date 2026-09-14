/**
 * Unified API key auth (Phase 25) — replaces the old split between
 * middleware/auth.js (flat API_KEYS) and middleware/metricsAuth.js
 * (per-app bcrypt keys). Covers: DB-backed scoped keys, the legacy flat-key
 * fallback and its scope restriction, missing/invalid keys, and revoked keys.
 */

const bcrypt = require('bcryptjs');

jest.mock('../src/models/ApiKeyCandidate', () => {
  const mockFn = jest.fn();
  mockFn.API_KEY_SCOPES = ['logs:read', 'logs:write', 'metrics:read', 'metrics:write'];
  mockFn.find = jest.fn();
  mockFn.findOne = jest.fn();
  mockFn.findOneAndUpdate = jest.fn();
  mockFn.updateOne = jest.fn().mockResolvedValue({});
  return mockFn;
});

jest.mock('../src/config', () => ({
  auth: { apiKeys: ['legacy-flat-key'] },
  retention: { hotStorageDays: 7 },
  rateLimit: { windowMs: 60000, maxRequests: 100 }
}));

const ApiKeyCandidate = require('../src/models/ApiKeyCandidate');
const apiKeyAuth = require('../src/middleware/apiKeyAuth');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function mockFindCandidates(rows) {
  ApiKeyCandidate.find.mockReturnValue({
    select: () => ({
      lean: async () => rows
    })
  });
}

describe('apiKeyAuth — DB-backed scoped keys', () => {
  const rawKey = 'sk_live_academicx_only';
  let liveHash;

  beforeAll(async () => {
    liveHash = await bcrypt.hash(rawKey, 4);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    ApiKeyCandidate.findOneAndUpdate.mockResolvedValue({});
  });

  test('valid key with the required scope attaches appId and calls next', async () => {
    mockFindCandidates([
      { subjectId: 'academicx', scopes: ['logs:read', 'logs:write'], liveHash, testHash: null }
    ]);

    const req = { headers: { 'x-api-key': rawKey } };
    const res = mockRes();
    const next = jest.fn();

    await apiKeyAuth('logs:write')(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.apiKeyAppId).toBe('academicx');
    expect(req.telemetryAppId).toBe('academicx');
  });

  test('valid key without the required scope returns 403', async () => {
    mockFindCandidates([
      { subjectId: 'academicx', scopes: ['logs:read'], liveHash, testHash: null }
    ]);

    const req = { headers: { 'x-api-key': rawKey } };
    const res = mockRes();
    const next = jest.fn();

    await apiKeyAuth('metrics:write')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringMatching(/not authorized for scope/i)
      })
    );
  });

  test('revoked candidate is excluded from the match set (findAuthCandidates filters revokedAt)', async () => {
    // apiKeyService.findAuthCandidates queries { revokedAt: null } — simulate
    // that by returning no rows, same as a real revoked-row query would.
    mockFindCandidates([]);

    const req = { headers: { 'x-api-key': rawKey } };
    const res = mockRes();
    const next = jest.fn();

    await apiKeyAuth('logs:read')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('missing key returns 401', async () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    await apiKeyAuth('logs:read')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('apiKeyAuth — legacy flat API_KEYS fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindCandidates([]);
  });

  test('legacy key satisfies logs:read', async () => {
    const req = { headers: { 'x-api-key': 'legacy-flat-key' } };
    const res = mockRes();
    const next = jest.fn();

    await apiKeyAuth('logs:read')(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.apiKeyAppId).toBeNull();
  });

  test('legacy key satisfies logs:write', async () => {
    const req = { headers: { 'x-api-key': 'legacy-flat-key' } };
    const res = mockRes();
    const next = jest.fn();

    await apiKeyAuth('logs:write')(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  test('legacy key satisfies metrics:read', async () => {
    const req = { headers: { 'x-api-key': 'legacy-flat-key' } };
    const res = mockRes();
    const next = jest.fn();

    await apiKeyAuth('metrics:read')(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  test('legacy key does NOT satisfy metrics:write (never had flat-key access)', async () => {
    const req = { headers: { 'x-api-key': 'legacy-flat-key' } };
    const res = mockRes();
    const next = jest.fn();

    await apiKeyAuth('metrics:write')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('unknown key (not DB-backed, not legacy) returns 403', async () => {
    const req = { headers: { 'x-api-key': 'totally-unknown' } };
    const res = mockRes();
    const next = jest.fn();

    await apiKeyAuth('logs:read')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/Invalid API key/i) })
    );
  });
});
