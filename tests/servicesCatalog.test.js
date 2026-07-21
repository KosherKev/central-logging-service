/**
 * P2: services catalog union + detail 404 / shape wiring.
 */

jest.mock('../src/models/Log', () => ({
  aggregate: jest.fn()
}));

jest.mock('../src/routes/metrics', () => {
  const actual = jest.requireActual('../src/routes/metrics');
  return {
    ...actual,
    fetchLatestMetricsSnapshot: jest.fn()
  };
});

const Log = require('../src/models/Log');
const { fetchLatestMetricsSnapshot } = require('../src/routes/metrics');
const {
  buildServicesCatalog,
  buildServiceDetail,
  fetchEndpointRollups
} = require('../src/routes/services');

describe('buildServicesCatalog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('unions log services with metrics-only appIds; sorts by totalRequests desc', async () => {
    const lastSeen = new Date('2026-07-21T12:01:00.000Z');

    Log.aggregate.mockResolvedValue([
      {
        _id: 'academicx',
        totalRequests: 800,
        errorCount: 12,
        avgDuration: 38,
        lastSeen
      },
      {
        _id: 'payments-api',
        totalRequests: 100,
        errorCount: 0,
        avgDuration: 10,
        lastSeen
      }
    ]);

    fetchLatestMetricsSnapshot.mockResolvedValue([
      {
        appId: 'academicx',
        health: { status: 'ok', instanceId: 'i1', timestamp: lastSeen },
        metrics: { students: 1 },
        metricsReportedAt: lastSeen,
        instanceCount: 3,
        instances: []
      },
      {
        appId: 'metrics-only',
        health: {
          status: 'ok',
          instanceId: 'm1',
          timestamp: lastSeen
        },
        metrics: null,
        metricsReportedAt: null,
        instanceCount: 1,
        instances: []
      }
    ]);

    const start = new Date('2026-07-20T12:00:00.000Z');
    const end = new Date('2026-07-21T12:00:00.000Z');
    const data = await buildServicesCatalog({ start, end });

    expect(data.map((d) => d.name)).toEqual([
      'academicx',
      'payments-api',
      'metrics-only'
    ]);
    expect(data[0].totalRequests).toBe(800);
    expect(data[0].errorRate).toBe(1.5);
    expect(data[0].avgLatency).toBe(38);
    expect(data[0].instanceCount).toBe(3);
    expect(data[2].totalRequests).toBe(0);
    expect(data[2].instanceCount).toBe(1);
    expect(data[2].displayName).toBe('Metrics-only');
  });
});

describe('buildServiceDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 404-null when no logs and no metrics', async () => {
    Log.aggregate.mockResolvedValue([]);
    fetchLatestMetricsSnapshot.mockResolvedValue([]);

    const data = await buildServiceDetail({
      name: 'ghost',
      start: new Date('2026-07-20T00:00:00.000Z'),
      end: new Date('2026-07-21T00:00:00.000Z')
    });
    expect(data).toBeNull();
  });

  test('includes endpoints + health/metrics/instances from metrics snapshot helpers', async () => {
    const ts = new Date('2026-07-21T12:00:00.000Z');

    // Promise.all races rollup + endpoint aggregates — key off pipeline shape
    Log.aggregate.mockImplementation((pipeline) => {
      const groupId = pipeline[1]?.$group?._id;
      if (groupId && typeof groupId === 'object' && 'method' in groupId) {
        return Promise.resolve([
          {
            method: 'GET',
            path: '/v1/students',
            requestCount: 400,
            errorCount: 2,
            avgLatency: 30,
            errorRate: 0.5
          }
        ]);
      }
      return Promise.resolve([
        {
          _id: 'academicx',
          totalRequests: 800,
          errorCount: 12,
          avgDuration: 38,
          lastSeen: ts
        }
      ]);
    });

    fetchLatestMetricsSnapshot.mockResolvedValue([
      {
        appId: 'academicx',
        health: {
          status: 'ok',
          instanceId: 'rev-abc',
          uptimeSeconds: 86400,
          timestamp: ts
        },
        metrics: { students: 120, activeToday: 45 },
        metricsReportedAt: ts,
        instanceCount: 3,
        instances: [
          {
            instanceId: 'rev-abc',
            lastSeen: ts,
            status: 'ok',
            uptimeSeconds: 86400
          }
        ]
      }
    ]);

    const data = await buildServiceDetail({
      name: 'academicx',
      start: new Date('2026-07-20T00:00:00.000Z'),
      end: new Date('2026-07-21T12:00:00.000Z')
    });

    expect(data.name).toBe('academicx');
    expect(data.totalRequests).toBe(800);
    expect(data.endpoints).toEqual([
      {
        method: 'GET',
        path: '/v1/students',
        requestCount: 400,
        errorCount: 2,
        avgLatency: 30,
        errorRate: 0.5
      }
    ]);
    expect(data.health.status).toBe('ok');
    expect(data.metrics.students).toBe(120);
    expect(data.instances).toHaveLength(1);
    expect(data.instanceCount).toBe(3);
    expect(fetchLatestMetricsSnapshot).toHaveBeenCalledWith('academicx', {
      instanceWindowSeconds: expect.any(Number)
    });
  });
});

describe('fetchEndpointRollups', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('builds method+path group pipeline capped at limit', async () => {
    Log.aggregate.mockResolvedValue([]);
    const start = new Date('2026-07-20T00:00:00.000Z');
    const end = new Date('2026-07-21T00:00:00.000Z');
    await fetchEndpointRollups({
      start,
      end,
      service: 'academicx',
      limit: 20
    });

    const pipeline = Log.aggregate.mock.calls[0][0];
    expect(pipeline[0].$match.service).toBe('academicx');
    expect(pipeline[1].$group._id).toEqual({
      method: { $ifNull: ['$method', ''] },
      path: { $ifNull: ['$path', ''] }
    });
    expect(pipeline[3].$limit).toBe(20);
  });
});
