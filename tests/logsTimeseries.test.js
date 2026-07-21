/**
 * Focused tests for GET /api/v1/logs/stats/timeseries window resolution + aggregation.
 */

jest.mock('../src/models/Log', () => ({
  aggregate: jest.fn()
}));

const Log = require('../src/models/Log');
const {
  TIME_RANGE_PRESETS,
  resolveTimeseriesWindow,
  fetchLogTimeseries
} = require('../src/routes/logs');

describe('resolveTimeseriesWindow', () => {
  test('defaults to last_24h with 1h buckets', () => {
    const resolved = resolveTimeseriesWindow({});
    expect(resolved.error).toBeUndefined();
    expect(resolved.timeRange).toBe('last_24h');
    expect(resolved.bucketMs).toBe(TIME_RANGE_PRESETS.last_24h.bucketMs);
    expect(resolved.end.getTime() - resolved.start.getTime()).toBe(
      TIME_RANGE_PRESETS.last_24h.windowMs
    );
  });

  test.each([
    ['last_hour', 5 * 60 * 1000],
    ['last_24h', 60 * 60 * 1000],
    ['last_7d', 12 * 60 * 60 * 1000],
    ['last_30d', 24 * 60 * 60 * 1000]
  ])('%s uses bucketMs=%i', (timeRange, bucketMs) => {
    const resolved = resolveTimeseriesWindow({ timeRange });
    expect(resolved.bucketMs).toBe(bucketMs);
    expect(resolved.timeRange).toBe(timeRange);
  });

  test('unknown timeRange returns error (400 path)', () => {
    const resolved = resolveTimeseriesWindow({ timeRange: 'last_year' });
    expect(resolved.error).toMatch(/Invalid timeRange/);
  });

  test('honors absolute from/to ISO window', () => {
    const resolved = resolveTimeseriesWindow({
      timeRange: 'last_24h',
      from: '2026-07-21T00:00:00.000Z',
      to: '2026-07-21T06:00:00.000Z'
    });
    expect(resolved.error).toBeUndefined();
    expect(resolved.start.toISOString()).toBe('2026-07-21T00:00:00.000Z');
    expect(resolved.end.toISOString()).toBe('2026-07-21T06:00:00.000Z');
    expect(resolved.bucketMs).toBe(TIME_RANGE_PRESETS.last_24h.bucketMs);
  });

  test('optional service is trimmed through', () => {
    const resolved = resolveTimeseriesWindow({ service: '  user-api  ' });
    expect(resolved.service).toBe('user-api');
  });
});

describe('fetchLogTimeseries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('builds match + bucket group pipeline and returns totalCount/errorCount', async () => {
    const start = new Date('2026-07-21T00:00:00.000Z');
    const end = new Date('2026-07-21T02:00:00.000Z');
    const bucketMs = 60 * 60 * 1000;

    Log.aggregate.mockResolvedValue([
      {
        timestamp: new Date('2026-07-21T00:00:00.000Z'),
        totalCount: 120,
        errorCount: 4
      },
      {
        timestamp: new Date('2026-07-21T01:00:00.000Z'),
        totalCount: 98,
        errorCount: 1
      }
    ]);

    const data = await fetchLogTimeseries({
      start,
      end,
      bucketMs,
      service: 'user-api'
    });

    expect(Log.aggregate).toHaveBeenCalledTimes(1);
    const pipeline = Log.aggregate.mock.calls[0][0];

    expect(pipeline[0]).toEqual({
      $match: {
        timestamp: { $gte: start, $lte: end },
        service: 'user-api'
      }
    });
    expect(pipeline[1].$group.totalCount).toEqual({ $sum: 1 });
    expect(pipeline[1].$group.errorCount).toEqual({
      $sum: { $cond: [{ $eq: ['$level', 'error'] }, 1, 0] }
    });
    expect(pipeline[2]).toEqual({ $sort: { _id: 1 } });

    expect(data).toEqual([
      {
        timestamp: new Date('2026-07-21T00:00:00.000Z'),
        totalCount: 120,
        errorCount: 4
      },
      {
        timestamp: new Date('2026-07-21T01:00:00.000Z'),
        totalCount: 98,
        errorCount: 1
      }
    ]);
  });
});
