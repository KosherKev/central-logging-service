/**
 * Per-user filter for GET /api/v1/logs (?userId=...).
 */

const { buildUserFilter } = require('../src/routes/logs');

describe('buildUserFilter', () => {
  test('no userId means no filter', () => {
    expect(buildUserFilter(undefined)).toBeNull();
    expect(buildUserFilter(null)).toBeNull();
    expect(buildUserFilter('')).toBeNull();
  });

  test('a plain string becomes an exact metadata.userId match', () => {
    expect(buildUserFilter('user123')).toEqual({ 'metadata.userId': 'user123' });
    expect(buildUserFilter('  user123  ')).toEqual({ 'metadata.userId': 'user123' });
  });

  test('operator objects (?userId[$ne]=x) are rejected, not passed to Mongo', () => {
    expect(buildUserFilter({ $ne: 'x' })).toBe(false);
    expect(buildUserFilter({ $regex: '.*' })).toBe(false);
    expect(buildUserFilter(['a', 'b'])).toBe(false);
  });

  test('blank-after-trim and over-long values are rejected', () => {
    expect(buildUserFilter('   ')).toBe(false);
    expect(buildUserFilter('x'.repeat(129))).toBe(false);
    expect(buildUserFilter('x'.repeat(128))).toEqual({ 'metadata.userId': 'x'.repeat(128) });
  });
});
