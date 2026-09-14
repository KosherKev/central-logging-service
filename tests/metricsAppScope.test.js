/**
 * enforceAppScope (routes/metrics.js) — unchanged by Phase 25's auth
 * unification, kept as defense-in-depth on top of apiKeyAuth('metrics:write').
 * A leaked key for app A must not be able to post as app B even if it
 * somehow carried the right scope.
 */

const { enforceAppScope } = require('../src/routes/metrics');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

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
