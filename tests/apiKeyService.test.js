/**
 * apiKeyService — the single write path for ApiKeyCandidate rows, shared by
 * the admin API, the setup wizard, and the generateAppApiKey.js CLI. Covers
 * lifecycle (create/list/revoke/rotate) and the invariant that a raw key is
 * only ever returned once, never persisted.
 */

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async (raw) => `hashed:${raw}`),
  compare: jest.fn()
}));

jest.mock('../src/models/ApiKeyCandidate', () => {
  const mockFn = jest.fn();
  mockFn.API_KEY_SCOPES = ['logs:read', 'logs:write', 'metrics:read', 'metrics:write'];
  mockFn.find = jest.fn();
  mockFn.findOne = jest.fn();
  mockFn.findOneAndUpdate = jest.fn();
  return mockFn;
});

const ApiKeyCandidate = require('../src/models/ApiKeyCandidate');
const apiKeyService = require('../src/services/apiKeyService');

beforeEach(() => {
  jest.clearAllMocks();
  ApiKeyCandidate.findOneAndUpdate.mockResolvedValue({});
});

describe('createKey', () => {
  test('rejects an unknown scope', async () => {
    await expect(
      apiKeyService.createKey({ appId: 'x', scopes: ['not:a:real:scope'], environment: 'live' })
    ).rejects.toThrow(/Invalid scope/);
  });

  test('rejects when no scopes given', async () => {
    await expect(
      apiKeyService.createKey({ appId: 'x', scopes: [], environment: 'live' })
    ).rejects.toThrow(/At least one scope/);
  });

  test('rejects a missing appId', async () => {
    await expect(
      apiKeyService.createKey({ scopes: ['logs:read'], environment: 'live' })
    ).rejects.toThrow(/appId is required/);
  });

  test('live-only: returns exactly one raw key, hashes it, never returns the hash', async () => {
    const result = await apiKeyService.createKey({
      appId: 'academicx',
      label: 'AcademicX producer',
      scopes: ['logs:write', 'metrics:write'],
      environment: 'live'
    });

    expect(result.rawKeys.live).toMatch(/^sk_live_/);
    expect(result.rawKeys.test).toBeUndefined();
    expect(result.scopes).toEqual(['logs:write', 'metrics:write']);

    expect(ApiKeyCandidate.findOneAndUpdate).toHaveBeenCalledWith(
      { subjectId: 'academicx' },
      expect.objectContaining({
        $set: expect.objectContaining({
          scopes: ['logs:write', 'metrics:write'],
          label: 'AcademicX producer',
          liveHash: `hashed:${result.rawKeys.live}`,
          revokedAt: null
        })
      }),
      expect.objectContaining({ upsert: true })
    );
    // The persisted value is a hash of the raw key, never the raw key itself
    const persistedSet = ApiKeyCandidate.findOneAndUpdate.mock.calls[0][1].$set;
    expect(persistedSet.liveHash).not.toBe(result.rawKeys.live);
  });

  test('both environments: returns two distinct raw keys', async () => {
    const result = await apiKeyService.createKey({
      appId: 'academicx',
      scopes: ['logs:read'],
      environment: 'both'
    });

    expect(result.rawKeys.test).toMatch(/^sk_test_/);
    expect(result.rawKeys.live).toMatch(/^sk_live_/);
    expect(result.rawKeys.test).not.toBe(result.rawKeys.live);
  });
});

describe('listKeys', () => {
  test('never includes hashes or raw keys, surfaces environments present', async () => {
    ApiKeyCandidate.find.mockReturnValue({
      select: () => ({
        sort: () => ({
          lean: async () => [
            {
              subjectId: 'academicx',
              label: 'AcademicX',
              scopes: ['logs:read'],
              testHash: 'th',
              liveHash: null,
              createdAt: new Date('2026-01-01'),
              lastUsedAt: null,
              revokedAt: null
            }
          ]
        })
      })
    });

    const rows = await apiKeyService.listKeys();

    expect(rows).toEqual([
      {
        appId: 'academicx',
        label: 'AcademicX',
        scopes: ['logs:read'],
        environments: ['test'],
        createdAt: new Date('2026-01-01'),
        lastUsedAt: null,
        revoked: false,
        revokedAt: null
      }
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/th|Hash/);
  });
});

describe('revokeKey', () => {
  test('sets revokedAt on an active candidate', async () => {
    const candidate = { revokedAt: null, save: jest.fn().mockResolvedValue() };
    ApiKeyCandidate.findOne.mockResolvedValue(candidate);

    const result = await apiKeyService.revokeKey('academicx');

    expect(candidate.revokedAt).toBeInstanceOf(Date);
    expect(candidate.save).toHaveBeenCalled();
    expect(result.revoked).toBe(true);
  });

  test('is idempotent — already-revoked candidate is not re-saved', async () => {
    const existingRevokedAt = new Date('2026-01-01');
    const candidate = { revokedAt: existingRevokedAt, save: jest.fn() };
    ApiKeyCandidate.findOne.mockResolvedValue(candidate);

    await apiKeyService.revokeKey('academicx');

    expect(candidate.save).not.toHaveBeenCalled();
    expect(candidate.revokedAt).toBe(existingRevokedAt);
  });

  test('throws for an unknown appId', async () => {
    ApiKeyCandidate.findOne.mockResolvedValue(null);
    await expect(apiKeyService.revokeKey('nobody')).rejects.toThrow(/No key found/);
  });
});

describe('rotateKey', () => {
  test('replaces only the requested environment hash', async () => {
    const candidate = {
      testHash: 'old-test-hash',
      liveHash: 'old-live-hash',
      save: jest.fn().mockResolvedValue()
    };
    ApiKeyCandidate.findOne.mockResolvedValue(candidate);

    const result = await apiKeyService.rotateKey('academicx', 'live');

    expect(result.rawKey).toMatch(/^sk_live_/);
    expect(candidate.liveHash).toBe(`hashed:${result.rawKey}`);
    expect(candidate.testHash).toBe('old-test-hash');
    expect(candidate.save).toHaveBeenCalled();
  });

  test('rejects an invalid environment', async () => {
    await expect(apiKeyService.rotateKey('academicx', 'staging')).rejects.toThrow(
      /environment must be/
    );
  });
});
