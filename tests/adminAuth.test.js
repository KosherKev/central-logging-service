/**
 * adminAuth — guards /admin/keys, a separate trust tier from app-level API
 * keys (this surface can mint and revoke those).
 */

jest.mock('../src/config', () => ({
  auth: { apiKeys: ['dev-key-123'], adminSetupToken: 'super-secret-admin-token' }
}));

const adminAuth = require('../src/middleware/adminAuth');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

test('missing Authorization header returns 401', () => {
  const req = { headers: {} };
  const res = mockRes();
  const next = jest.fn();

  adminAuth(req, res, next);

  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(401);
});

test('wrong bearer token returns 403', () => {
  const req = { headers: { authorization: 'Bearer wrong-token' } };
  const res = mockRes();
  const next = jest.fn();

  adminAuth(req, res, next);

  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(403);
});

test('correct bearer token calls next', () => {
  const req = { headers: { authorization: 'Bearer super-secret-admin-token' } };
  const res = mockRes();
  const next = jest.fn();

  adminAuth(req, res, next);

  expect(next).toHaveBeenCalledWith();
  expect(res.status).not.toHaveBeenCalled();
});

test('unconfigured ADMIN_SETUP_TOKEN returns 503 regardless of header', () => {
  jest.resetModules();
  jest.doMock('../src/config', () => ({
    auth: { apiKeys: ['dev-key-123'], adminSetupToken: null }
  }));
  const adminAuthUnconfigured = require('../src/middleware/adminAuth');

  const req = { headers: { authorization: 'Bearer anything' } };
  const res = mockRes();
  const next = jest.fn();

  adminAuthUnconfigured(req, res, next);

  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(503);
});
