/**
 * Error groups: extractErrorDisplay + fingerprint + fetchErrorGroups wiring.
 */

jest.mock('../src/models/Log', () => ({
  find: jest.fn()
}));

const Log = require('../src/models/Log');
const {
  normalizeErrorMessage,
  fingerprintError,
  computeTrend,
  extractErrorDisplay
} = require('../src/utils/errorFingerprint');
const { fetchErrorGroups } = require('../src/routes/logs');

function mockFindLean(docs) {
  Log.find.mockReturnValue({
    select: () => ({
      lean: async () => docs
    })
  });
}

describe('error fingerprint helpers', () => {
  test('normalize collapses UUIDs, ObjectIds, IPs, numbers, whitespace', () => {
    expect(
      normalizeErrorMessage(
        'User 123 failed id=550e8400-e29b-41d4-a716-446655440000 at 10.0.0.1:27017  '
      )
    ).toBe('user N failed id=<uuid> at <ip>');
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
  });
});

describe('extractErrorDisplay', () => {
  test('prefers top-level error.message (regression)', () => {
    const out = extractErrorDisplay({
      error: { message: 'Top level boom', code: 'E1', stack: 'stack-top' },
      response: {
        body: { message: 'body should lose', error: 'Internal Server Error' }
      },
      statusCode: 500
    });
    expect(out.message).toBe('Top level boom');
    expect(out.errorCode).toBe('E1');
    expect(out.stack).toBe('stack-top');
  });

  test('error:null + body.error.message (fyp Empty file)', () => {
    const out = extractErrorDisplay({
      error: null,
      statusCode: 500,
      response: {
        body: {
          success: false,
          error: { message: 'Empty file', statusCode: 500 }
        }
      }
    });
    expect(out.message).toBe('Empty file');
    expect(out.message).not.toBe('Unknown error');
    expect(out.statusCode).toBe(500);
  });

  test('body.message preferred over generic string body.error', () => {
    const out = extractErrorDisplay({
      error: null,
      statusCode: 500,
      response: {
        body: {
          success: false,
          message: 'this.database.isConnected is not a function',
          error: 'Internal Server Error'
        }
      }
    });
    expect(out.message).toBe('this.database.isConnected is not a function');
  });

  test('body.error.stack becomes sample stack', () => {
    const out = extractErrorDisplay({
      error: null,
      response: {
        body: {
          success: false,
          error: {
            message: 'connect ECONNREFUSED 65.62.2.172:27017',
            statusCode: 500,
            stack: 'MongoServerSelectionError: connect ECONNREFUSED …'
          }
        }
      },
      statusCode: 500
    });
    expect(out.message).toContain('connect ECONNREFUSED');
    expect(out.stack).toContain('MongoServerSelectionError');
  });

  test('JSON string response.body is parsed', () => {
    const out = extractErrorDisplay({
      error: null,
      statusCode: 500,
      response: {
        body: JSON.stringify({
          success: false,
          error: { message: 'Empty file', statusCode: 500 }
        })
      }
    });
    expect(out.message).toBe('Empty file');
  });

  test('non-JSON short body string is used as message', () => {
    const out = extractErrorDisplay({
      error: null,
      statusCode: 500,
      response: { body: 'plain failure text' }
    });
    expect(out.message).toBe('plain failure text');
  });

  test('status-only → HTTP 502 (not Unknown error)', () => {
    const out = extractErrorDisplay({
      error: null,
      statusCode: 502,
      response: { body: null }
    });
    expect(out.message).toBe('HTTP 502');
  });

  test('nothing at all → Error sentinel (not Unknown error)', () => {
    const out = extractErrorDisplay({ error: null });
    expect(out.message).toBe('Error');
  });

  test('two different body messages → different fingerprints', () => {
    const a = extractErrorDisplay({
      error: null,
      response: { body: { error: { message: 'Empty file' } } }
    });
    const b = extractErrorDisplay({
      error: null,
      response: { body: { message: 'missing exceljs' } }
    });
    expect(fingerprintError(a.message, a.errorCode)).not.toBe(
      fingerprintError(b.message, b.errorCode)
    );
  });
});

describe('fetchErrorGroups', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('empty window → []', async () => {
    mockFindLean([]);
    const data = await fetchErrorGroups({
      start: new Date('2026-07-21T00:00:00.000Z'),
      end: new Date('2026-07-21T12:00:00.000Z'),
      limit: 50
    });
    expect(data).toEqual([]);
    expect(Log.find).toHaveBeenCalled();
  });

  test('body-only failures split into distinct groups; no Unknown error megagroup', async () => {
    const t1 = new Date('2026-07-21T08:00:00.000Z');
    const t2 = new Date('2026-07-21T12:30:00.000Z');
    const t3 = new Date('2026-07-21T13:00:00.000Z');

    mockFindLean([
      {
        timestamp: t1,
        service: 'fyp-management-backend',
        statusCode: 500,
        traceId: 'trace-empty',
        error: null,
        response: {
          body: {
            success: false,
            error: { message: 'Empty file', statusCode: 500 }
          }
        }
      },
      {
        timestamp: t2,
        service: 'fyp-management-backend',
        statusCode: 500,
        traceId: 'trace-mongo',
        error: null,
        response: {
          body: {
            success: false,
            error: {
              message: 'connect ECONNREFUSED 65.62.2.172:27017',
              stack: 'MongoServerSelectionError: connect ECONNREFUSED …'
            }
          }
        }
      },
      {
        timestamp: t3,
        service: 'academicx-api',
        statusCode: 500,
        traceId: 'trace-mongo-2',
        error: null,
        response: {
          body: {
            success: false,
            error: {
              message: 'connect ECONNREFUSED 1.2.3.4:27017',
              stack: 'MongoServerSelectionError: …'
            }
          }
        }
      },
      {
        timestamp: t1,
        service: 'payment-gateway-api',
        statusCode: 502,
        traceId: 'trace-http',
        error: null,
        response: { body: null }
      }
    ]);

    const data = await fetchErrorGroups({
      start: new Date('2026-07-21T00:00:00.000Z'),
      end: new Date('2026-07-21T16:00:00.000Z'),
      limit: 50
    });

    const messages = data.map((g) => g.message);
    expect(messages).not.toContain('Unknown error');
    expect(messages).toEqual(
      expect.arrayContaining([
        'Empty file',
        expect.stringContaining('connect ECONNREFUSED'),
        'HTTP 502'
      ])
    );

    // Same normalized ECONNREFUSED across services → one group, count 2, 2 services
    const mongoGroup = data.find((g) =>
      g.message.toLowerCase().includes('econnrefused')
    );
    expect(mongoGroup.count).toBe(2);
    expect(mongoGroup.services).toEqual([
      'academicx-api',
      'fyp-management-backend'
    ]);
    expect(mongoGroup.sampleStack).toContain('MongoServerSelectionError');

    expect(data.find((g) => g.message === 'Empty file').count).toBe(1);
    expect(data.find((g) => g.message === 'HTTP 502').sampleStatusCode).toBe(
      502
    );
  });

  test('top-level error.message still groups (regression)', async () => {
    const t = new Date('2026-07-21T12:00:00.000Z');
    mockFindLean([
      {
        timestamp: t,
        service: 'svc-a',
        statusCode: 500,
        traceId: 't1',
        error: {
          message: 'Top level failure',
          code: 'EFAIL',
          stack: 'Error: Top level failure'
        },
        response: { body: null }
      },
      {
        timestamp: t,
        service: 'svc-b',
        statusCode: 500,
        traceId: 't2',
        error: {
          message: 'Top level failure',
          code: 'EFAIL'
        },
        response: { body: null }
      }
    ]);

    const data = await fetchErrorGroups({
      start: new Date('2026-07-21T00:00:00.000Z'),
      end: new Date('2026-07-21T16:00:00.000Z')
    });

    expect(data).toHaveLength(1);
    expect(data[0].message).toBe('Top level failure');
    expect(data[0].errorCode).toBe('EFAIL');
    expect(data[0].count).toBe(2);
    expect(data[0].services).toEqual(['svc-a', 'svc-b']);
    expect(data[0].id).toBe(fingerprintError('Top level failure', 'EFAIL'));
  });

  test('match uses isError rule (level error OR statusCode >= 400)', async () => {
    mockFindLean([]);
    await fetchErrorGroups({
      start: new Date('2026-07-21T00:00:00.000Z'),
      end: new Date('2026-07-21T16:00:00.000Z')
    });
    const match = Log.find.mock.calls[0][0];
    expect(match.$or).toEqual([
      { level: 'error' },
      { statusCode: { $gte: 400 } }
    ]);
  });
});
