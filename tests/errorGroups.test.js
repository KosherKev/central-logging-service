/**
 * P2: error fingerprint stability + group fetch wiring.
 */

jest.mock('../src/models/Log', () => ({
  aggregate: jest.fn()
}));

const Log = require('../src/models/Log');
const {
  normalizeErrorMessage,
  fingerprintError,
  computeTrend,
  pickDisplayMessage
} = require('../src/utils/errorFingerprint');
const { fetchErrorGroups } = require('../src/routes/logs');

describe('error fingerprint helpers', () => {
  test('normalize collapses UUIDs, numbers, and whitespace', () => {
    expect(
      normalizeErrorMessage(
        'User 123 failed id=550e8400-e29b-41d4-a716-446655440000  '
      )
    ).toBe('user N failed id=<uuid>');
  });

  test('fingerprint is stable for same logical message', () => {
    const a = fingerprintError(
      'Connection refused to redis host 10',
      'ECONNREFUSED'
    );
    const b = fingerprintError(
      'Connection refused to redis host 99',
      'ECONNREFUSED'
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^fp_[0-9a-f]{12}$/);
  });

  test('fingerprint differs when code differs', () => {
    const a = fingerprintError('timeout', 'ETIMEDOUT');
    const b = fingerprintError('timeout', 'ECONNRESET');
    expect(a).not.toBe(b);
  });

  test('computeTrend compares window halves', () => {
    expect(computeTrend(10, 20)).toBe('increasing');
    expect(computeTrend(20, 10)).toBe('decreasing');
    expect(computeTrend(10, 11)).toBe('stable');
    expect(computeTrend(0, 5)).toBe('increasing');
    expect(computeTrend(5, 0)).toBe('decreasing');
  });

  test('pickDisplayMessage prefers message then code', () => {
    expect(pickDisplayMessage(' boom ', 'E1')).toBe('boom');
    expect(pickDisplayMessage('', 'E1')).toBe('E1');
    expect(pickDisplayMessage(null, null)).toBe('Unknown error');
  });
});

describe('fetchErrorGroups', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('empty aggregation → []', async () => {
    Log.aggregate.mockResolvedValue([]);
    const start = new Date('2026-07-21T00:00:00.000Z');
    const end = new Date('2026-07-21T12:00:00.000Z');
    const data = await fetchErrorGroups({ start, end, limit: 50 });
    expect(data).toEqual([]);
  });

  test('maps rows to groups with fingerprint id, count, trend; sorted lastSeen desc', async () => {
    const t1 = new Date('2026-07-21T08:00:00.000Z');
    const t2 = new Date('2026-07-21T12:30:00.000Z');

    Log.aggregate.mockResolvedValue([
      {
        _id: { msgKey: 'connection refused to redis', code: 'ECONNREFUSED' },
        count: 47,
        services: ['academicx', 'payments-api'],
        firstSeen: t1,
        lastSeen: t2,
        sampleMessage: 'Connection refused to redis',
        sampleStack: 'Error: ...\n    at ...',
        sampleTraceId: 'trace-abc',
        sampleCode: 'ECONNREFUSED',
        recentCount: 30,
        earlierCount: 17
      },
      {
        _id: { msgKey: 'other', code: '' },
        count: 2,
        services: ['academicx'],
        firstSeen: t1,
        lastSeen: t1,
        sampleMessage: 'other',
        sampleStack: null,
        sampleTraceId: 'trace-x',
        sampleCode: null,
        recentCount: 0,
        earlierCount: 2
      }
    ]);

    const data = await fetchErrorGroups({
      start: new Date('2026-07-21T00:00:00.000Z'),
      end: new Date('2026-07-21T16:00:00.000Z'),
      limit: 50
    });

    expect(data).toHaveLength(2);
    expect(data[0].lastSeen).toEqual(t2);
    expect(data[0].id).toBe(
      fingerprintError('Connection refused to redis', 'ECONNREFUSED')
    );
    expect(data[0].count).toBe(47);
    expect(data[0].services).toEqual(['academicx', 'payments-api']);
    expect(data[0].trend).toBe('increasing');
    expect(data[0].sampleTraceId).toBe('trace-abc');
    expect(data[1].trend).toBe('decreasing');

    const pipeline = Log.aggregate.mock.calls[0][0];
    expect(pipeline[0].$match.$or).toEqual([
      { level: 'error' },
      { statusCode: { $gte: 400 } }
    ]);
  });

  test('merges pre-groups that share a fingerprint after normalize', async () => {
    const t = new Date('2026-07-21T12:00:00.000Z');
    Log.aggregate.mockResolvedValue([
      {
        _id: { msgKey: 'user 1 failed', code: '' },
        count: 3,
        services: ['a'],
        firstSeen: t,
        lastSeen: t,
        sampleMessage: 'User 1 failed',
        sampleStack: null,
        sampleTraceId: 't1',
        sampleCode: null,
        recentCount: 3,
        earlierCount: 0
      },
      {
        _id: { msgKey: 'user 99 failed', code: '' },
        count: 2,
        services: ['b'],
        firstSeen: t,
        lastSeen: t,
        sampleMessage: 'User 99 failed',
        sampleStack: null,
        sampleTraceId: 't2',
        sampleCode: null,
        recentCount: 2,
        earlierCount: 0
      }
    ]);

    const data = await fetchErrorGroups({
      start: new Date('2026-07-21T00:00:00.000Z'),
      end: new Date('2026-07-21T16:00:00.000Z')
    });

    expect(data).toHaveLength(1);
    expect(data[0].count).toBe(5);
    expect(data[0].services).toEqual(['a', 'b']);
    expect(data[0].id).toBe(fingerprintError('User 1 failed', null));
  });
});
