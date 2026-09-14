const express = require('express');
const router = express.Router();
const adminAuth = require('../../middleware/adminAuth');
const apiKeyService = require('../../services/apiKeyService');
const ApiKeyCandidate = require('../../models/ApiKeyCandidate');
const logger = require('../../utils/logger');

router.use(adminAuth);

/**
 * @route   GET /admin/keys
 * @desc    List provisioned keys (never hashes or raw keys)
 * @access  Admin (ADMIN_SETUP_TOKEN bearer)
 */
router.get('/', async (req, res) => {
  try {
    const keys = await apiKeyService.listKeys();
    res.json({ success: true, data: keys, scopes: ApiKeyCandidate.API_KEY_SCOPES });
  } catch (error) {
    logger.error('Error listing API keys', { error: { message: error.message, stack: error.stack } });
    res.status(500).json({ success: false, error: 'Failed to list keys' });
  }
});

/**
 * @route   POST /admin/keys
 * @desc    Create (or add an environment to) an app's key. Raw key(s)
 *          returned ONCE in the response — never persisted, never logged.
 * @access  Admin (ADMIN_SETUP_TOKEN bearer)
 * @body    { appId, label?, scopes: string[], environment?: 'test'|'live'|'both' }
 */
router.post('/', async (req, res) => {
  try {
    const { appId, label, scopes, environment } = req.body || {};
    const result = await apiKeyService.createKey({ appId, label, scopes, environment });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    // Validation errors from apiKeyService (bad appId/scopes/environment) are
    // caller mistakes, not server failures.
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * @route   POST /admin/keys/:appId/revoke
 * @desc    Soft-revoke — the key(s) stop matching on their very next request
 * @access  Admin (ADMIN_SETUP_TOKEN bearer)
 */
router.post('/:appId/revoke', async (req, res) => {
  try {
    const result = await apiKeyService.revokeKey(req.params.appId);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(404).json({ success: false, error: error.message });
  }
});

/**
 * @route   POST /admin/keys/:appId/rotate
 * @desc    Regenerate one environment's key. Raw key returned ONCE.
 * @access  Admin (ADMIN_SETUP_TOKEN bearer)
 * @body    { environment: 'test'|'live' }
 */
router.post('/:appId/rotate', async (req, res) => {
  try {
    const { environment } = req.body || {};
    const result = await apiKeyService.rotateKey(req.params.appId, environment);
    res.json({ success: true, data: result });
  } catch (error) {
    const status = /No key found/.test(error.message) ? 404 : 400;
    res.status(status).json({ success: false, error: error.message });
  }
});

module.exports = router;
