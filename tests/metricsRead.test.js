/**
 * Focused tests for GET /api/v1/metrics snapshot merge + aggregation wiring.
 */

jest.mock('../src/models/Metric', () => ({
  aggregate: jest.fn()
}));

const Metric = require('../src/models/Metric');
const {
  mergeLatestByApp,
  attachInstanceStats,
  fetchLatestMetricsSnapshot
} = require('../src/routes/metrics');

describe('mergeLatestByApp', () => {
  const healthTs = new Date('2026-07-20T12:00:00.000Z');
  const metricTs = new Date('2026-07-20T12:05:00.000Z');

  test('merges latest health and metrics for the same appId', () => {
    const result = mergeLatestByApp(
      [
        {
          _id: 'academicx',
          doc: {
            status: 'ok',
            instanceId: 'rev-1',
            uptimeSeconds: 1234,
            timestamp: healthTs
          }
        }
      ],
      [
        {
          _id: 'academicx',
          doc: {
            metrics: { activeStudents: 412 },
            timestamp: metricTs
          }
        }
      ]
    );

    expect(result).toEqual([
      {
        appId: 'academicx',
        health: {
          status: 'ok',
          instanceId: 'rev-1',
          uptimeSeconds: 1234,
          timestamp: healthTs
        },
        metrics: { activeStudents: 412 },
        metricsReportedAt: metricTs
      }
    ]);
  });

  test('missing kind is null (health only or metrics only)', () => {
    const healthOnly = mergeLatestByApp(
      [
        {
          _id: 'academicx',
          doc: {
            status: 'ok',
            instanceId: 'rev-1',
            uptimeSeconds: 10,
            timestamp: healthTs
          }
        }
      ],
      []
    );

    expect(healthOnly).toEqual([
      {
        appId: 'academicx',
        health: {
          status: 'ok',
          instanceId: 'rev-1',
          uptimeSeconds: 10,
          timestamp: healthTs
        },
        metrics: null,
        metricsReportedAt: null
      }
    ]);

    const metricsOnly = mergeLatestByApp(
      [],
      [
        {
          _id: 'didipay',
          doc: {
            metrics: { queueDepth: 3 },
            timestamp: metricTs
          }
        }
      ]
    );

    expect(metricsOnly).toEqual([
      {
        appId: 'didipay',
        health: null,
        metrics: { queueDepth: 3 },
        metricsReportedAt: metricTs
      }
    ]);
  });

  test('multiple apps each get one merged entry', () => {
    const result = mergeLatestByApp(
      [
        {
          _id: 'academicx',
          doc: {
            status: 'ok',
            instanceId: 'a',
            timestamp: healthTs
          }
        },
        {
          _id: 'didipay',
          doc: {
            status: 'ok',
            instanceId: 'd',
            timestamp: healthTs
          }
        }
      ],
      [
        {
          _id: 'academicx',
          doc: { metrics: { n: 1 }, timestamp: metricTs }
        }
      ]
    );

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.appId === 'academicx').metrics).toEqual({ n: 1 });
    expect(result.find((r) => r.appId === 'didipay').metrics).toBeNull();
    expect(result.find((r) => r.appId === 'didipay').health.status).toBe('ok');
  });
});

describe('attachInstanceStats', () => {
  test('sets instanceCount from distinct instances, not health.instanceId alone', () => {
    const rows = [
      {
        appId: 'academicx',
        health: {
          status: 'ok',
          instanceId: 'rev-1',
          uptimeSeconds: 10,
          timestamp: new Date()
        },
        metrics: null,
        metricsReportedAt: null
      }
    ];

    const withMulti = attachInstanceStats(rows, [
      {
        appId: 'academicx',
        instanceId: 'rev-1',
        lastSeen: new Date('2026-07-21T12:00:00.000Z'),
        status: 'ok',
        uptimeSeconds: 86400
      },
      {
        appId: 'academicx',
        instanceId: 'rev-2',
        lastSeen: new Date('2026-07-21T11:58:00.000Z'),
        status: 'degraded',
        uptimeSeconds: 1200
      },
      {
        appId: 'academicx',
        instanceId: 'rev-3',
        lastSeen: new Date('2026-07-21T11:55:00.000Z'),
        status: 'ok',
        uptimeSeconds: 300
      }
    ]);

    expect(withMulti[0].instanceCount).toBe(3);
    expect(withMulti[0].instances).toHaveLength(3);
    expect(withMulti[0].instances[0].instanceId).toBe('rev-1');
    expect(withMulti[0].instances[1].status).toBe('degraded');
  });

  test('single-instance app gets instanceCount: 1', () => {
    const rows = [
      {
        appId: 'solo',
        health: { status: 'ok', instanceId: 'only', timestamp: new Date() },
        metrics: null,
        metricsReportedAt: null
      }
    ];

    const out = attachInstanceStats(rows, [
      {
        appId: 'solo',
        instanceId: 'only',
        lastSeen: new Date(),
        status: 'ok',
        uptimeSeconds: 1
      }
    ]);

    expect(out[0].instanceCount).toBe(1);
    expect(out[0].instances).toHaveLength(1);
  });

  test('no activity in window → instanceCount 0 and empty instances[]', () => {
    const rows = [
      {
        appId: 'quiet',
        health: { status: 'ok', instanceId: 'old', timestamp: new Date() },
        metrics: null,
        metricsReportedAt: null
      }
    ];

    const out = attachInstanceStats(rows, []);
    expect(out[0].instanceCount).toBe(0);
    expect(out[0].instances).toEqual([]);
  });
});

describe('fetchLatestMetricsSnapshot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('runs sort+group aggregation per kind + instance window and merges', async () => {
    const healthTs = new Date('2026-07-20T12:00:00.000Z');
    const metricTs = new Date('2026-07-20T12:05:00.000Z');
    const lastSeen = new Date('2026-07-20T12:04:00.000Z');

    Metric.aggregate
      .mockResolvedValueOnce([
        {
          _id: 'academicx',
          doc: {
            status: 'ok',
            instanceId: 'rev-1',
            uptimeSeconds: 99,
            timestamp: healthTs
          }
        }
      ])
      .mockResolvedValueOnce([
        {
          _id: 'academicx',
          doc: {
            metrics: { activeStudents: 412 },
            timestamp: metricTs
          }
        }
      ])
      .mockResolvedValueOnce([
        {
          appId: 'academicx',
          instanceId: 'rev-1',
          lastSeen,
          status: 'ok',
          uptimeSeconds: 99
        },
        {
          appId: 'academicx',
          instanceId: 'rev-2',
          lastSeen,
          status: 'ok',
          uptimeSeconds: 50
        }
      ]);

    const data = await fetchLatestMetricsSnapshot();

    expect(Metric.aggregate).toHaveBeenCalledTimes(3);

    const healthPipeline = Metric.aggregate.mock.calls[0][0];
    const metricPipeline = Metric.aggregate.mock.calls[1][0];
    const instancePipeline = Metric.aggregate.mock.calls[2][0];

    expect(healthPipeline).toEqual([
      { $match: { kind: 'health' } },
      { $sort: { timestamp: -1 } },
      { $group: { _id: '$appId', doc: { $first: '$$ROOT' } } }
    ]);
    expect(metricPipeline).toEqual([
      { $match: { kind: 'metric' } },
      { $sort: { timestamp: -1 } },
      { $group: { _id: '$appId', doc: { $first: '$$ROOT' } } }
    ]);
    expect(instancePipeline[0].$match.kind).toBeUndefined();
    expect(instancePipeline[0].$match.timestamp.$gte).toBeInstanceOf(Date);

    expect(data).toEqual([
      {
        appId: 'academicx',
        health: {
          status: 'ok',
          instanceId: 'rev-1',
          uptimeSeconds: 99,
          timestamp: healthTs
        },
        metrics: { activeStudents: 412 },
        metricsReportedAt: metricTs,
        instanceCount: 2,
        instances: [
          {
            instanceId: 'rev-1',
            lastSeen,
            status: 'ok',
            uptimeSeconds: 99
          },
          {
            instanceId: 'rev-2',
            lastSeen,
            status: 'ok',
            uptimeSeconds: 50
          }
        ]
      }
    ]);
  });

  test('filters by appId when provided', async () => {
    Metric.aggregate
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await fetchLatestMetricsSnapshot('academicx');

    expect(Metric.aggregate.mock.calls[0][0][0]).toEqual({
      $match: { appId: 'academicx', kind: 'health' }
    });
    expect(Metric.aggregate.mock.calls[1][0][0]).toEqual({
      $match: { appId: 'academicx', kind: 'metric' }
    });
    expect(Metric.aggregate.mock.calls[2][0][0].$match.appId).toBe('academicx');
  });
});
