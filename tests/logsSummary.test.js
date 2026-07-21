/**
 * P1: per-service summary stats + list envelope helpers.
 */

const { formatByServiceStats } = require('../src/routes/logs');

describe('formatByServiceStats', () => {
  test('maps aggregation rows to totalRequests/errorCount/errorRate/avgDuration', () => {
    const byService = formatByServiceStats([
      {
        _id: 'academicx',
        totalRequests: 800,
        errorCount: 12,
        avgDuration: 38
      },
      {
        _id: 'payments-api',
        totalRequests: 720,
        errorCount: 28,
        avgDuration: 51
      }
    ]);

    expect(byService).toEqual({
      academicx: {
        totalRequests: 800,
        errorCount: 12,
        errorRate: 1.5,
        avgDuration: 38
      },
      'payments-api': {
        totalRequests: 720,
        errorCount: 28,
        errorRate: 3.89,
        avgDuration: 51
      }
    });
  });

  test('errorRate is 0 when totalRequests is 0; null avgDuration → 0', () => {
    const byService = formatByServiceStats([
      { _id: 'empty', totalRequests: 0, errorCount: 0, avgDuration: null }
    ]);

    expect(byService.empty).toEqual({
      totalRequests: 0,
      errorCount: 0,
      errorRate: 0,
      avgDuration: 0
    });
  });

  test('skips rows without _id (service)', () => {
    expect(formatByServiceStats([{ _id: null, totalRequests: 1 }])).toEqual({});
    expect(formatByServiceStats([])).toEqual({});
  });

  test('errorRate is percent 0–100 rounded to 2 decimals', () => {
    const byService = formatByServiceStats([
      { _id: 'svc', totalRequests: 3, errorCount: 1, avgDuration: 10 }
    ]);
    // 1/3 * 100 = 33.333… → 33.33
    expect(byService.svc.errorRate).toBe(33.33);
  });
});
