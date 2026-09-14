const config = require('../config');

/**
 * Guards /admin/keys — a separate, higher trust tier from app-level API
 * keys (this surface can mint and revoke those). v1 is a single shared
 * bearer token (ADMIN_SETUP_TOKEN), generated once by `npm run setup`.
 * Not a multi-operator login system — see PHASE_25_SPEC.md Step 5's
 * flagged design decision if that's ever needed.
 */
const adminAuth = (req, res, next) => {
  if (!config.auth.adminSetupToken) {
    return res.status(503).json({
      success: false,
      error: 'Admin API is not configured. Set ADMIN_SETUP_TOKEN (see `npm run setup`).'
    });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Missing admin token. Include "Authorization: Bearer <token>".'
    });
  }

  if (token !== config.auth.adminSetupToken) {
    return res.status(403).json({
      success: false,
      error: 'Invalid admin token.'
    });
  }

  next();
};

module.exports = adminAuth;
