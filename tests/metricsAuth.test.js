/**
 * Security-focused tests for per-app metrics auth.
 * Covers: valid key, invalid key, missing key, wrong-app mismatch.
 */

const bcrypt = require('bcryptjs');

jest.mock('../src/models/ApiKeyCandidate', () => ({
  find: jest.fn()
}));

const ApiKeyCandidate = require('../src/models/ApiKeyCandidate');
const metricsAuth = require('../src/middleware/metricsAuth');
const { enforceAppScope } = require('../src/routes/metrics');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('metricsAuth', () => {
  const rawLiveKey = 'sk_live_test_valid_key_for_academicx_only';
  let liveHash;

  beforeAll(async () => {
    liveHash = await bcrypt.hash(rawLiveKey, 4);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('valid key attaches telemetryAppId and environment, then calls next', async () => {
    ApiKeyCandidate.find.mockReturnValue({
      select: () => ({
        lean: async () => [
          { subjectId: 'academicx', liveHash, testHash: null }
        ]
      })
    });

    const req = { headers: { 'x-api-key': rawLiveKey } };
    const res = mockRes();
    const next = jest.fn();

    await metricsAuth(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.telemetryAppId).toBe('academicx');
    expect(req.telemetryKeyEnvironment).toBe('live');
  });

  test('missing key returns 401', async () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    await metricsAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringMatching(/Missing API key/i)
      })
    );
  });

  test('invalid key returns 403', async () => {
    ApiKeyCandidate.find.mockReturnValue({
      select: () => ({
        lean: async () => [
          { subjectId: 'academicx', liveHash, testHash: null }
        ]
      })
    });

    const req = { headers: { 'x-api-key': 'sk_live_definitely_wrong_key' } };
    const res = mockRes();
    const next = jest.fn();

    await metricsAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringMatching(/Invalid API key/i)
      })
    );
  });

  test('malformed key (no sk_test_/sk_live_ prefix) returns 403', async () => {
    ApiKeyCandidate.find.mockReturnValue({
      select: () => ({
        lean: async () => [
          { subjectId: 'academicx', liveHash, testHash: null }
        ]
      })
    });

    const req = { headers: { 'x-api-key': 'cls_old_flat_style_key' } };
    const res = mockRes();
    const next = jest.fn();

    await metricsAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('enforceAppScope (route-level app binding)', () => {
  test('allows when body.appId matches authenticated telemetryAppId', () => {
    const req = { body: { appId: 'academicx' }, telemetryAppId: 'academicx' };
    const res = mockRes();

    expect(enforceAppScope(req, res)).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects with 403 when body.appId does not match (wrong-app mismatch)', () => {
    const req = { body: { appId: 'didipay' }, telemetryAppId: 'academicx' };
    const res = mockRes();

    expect(enforceAppScope(req, res)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringMatching(/not authorized for this appId/i)
      })
    );
  });
});
