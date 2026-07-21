/**
 * Focused tests for GET /api/v1/metrics snapshot merge + aggregation wiring.
 */

jest.mock('../src/models/Metric', () => ({
  aggregate: jest.fn()
}));

const Metric = require('../src/models/Metric');
const {
  mergeLatestByApp,
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

describe('fetchLatestMetricsSnapshot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('runs sort+group aggregation per kind and merges (all apps)', async () => {
    const healthTs = new Date('2026-07-20T12:00:00.000Z');
    const metricTs = new Date('2026-07-20T12:05:00.000Z');

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
      ]);

    const data = await fetchLatestMetricsSnapshot();

    expect(Metric.aggregate).toHaveBeenCalledTimes(2);

    const healthPipeline = Metric.aggregate.mock.calls[0][0];
    const metricPipeline = Metric.aggregate.mock.calls[1][0];

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
        metricsReportedAt: metricTs
      }
    ]);
  });

  test('filters by appId when provided', async () => {
    Metric.aggregate.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await fetchLatestMetricsSnapshot('academicx');

    expect(Metric.aggregate.mock.calls[0][0][0]).toEqual({
      $match: { appId: 'academicx', kind: 'health' }
    });
    expect(Metric.aggregate.mock.calls[1][0][0]).toEqual({
      $match: { appId: 'academicx', kind: 'metric' }
    });
  });
});
