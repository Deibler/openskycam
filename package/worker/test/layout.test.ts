import { describe, expect, it } from 'vitest';
import { hourPrefix, parseSegmentStart, segmentKey } from '../../shared/src/utils/layoutStorageUtil';

describe('parseSegmentStart', () => {
  it('reads relay file names as UTC', () => {
    expect(parseSegmentStart('20260922T140500Z')?.toISOString()).toBe('2026-09-22T14:05:00.000Z');
  });

  it.each([
    ['an impossible month and hour', '20261340T256199Z'],
    ['February 30th', '20260230T000000Z'],
    ['an ISO timestamp', '2026-09-22T14:05:00Z'],
    ['a missing Z', '20260922T140500'],
    ['an empty string', ''],
  ])('rejects %s', (_case, value) => {
    expect(parseSegmentStart(value)).toBeNull();
  });
});

describe('segmentKey', () => {
  it('partitions by camera, UTC date and hour', () => {
    expect(segmentKey('sky01', new Date('2026-09-22T14:05:00Z'))).toBe(
      'raw/cam=sky01/date=2026-09-22/hour=14/sky01_20260922T140500Z.mp4',
    );
  });

  it("puts a segment just before midnight in that day's last hour", () => {
    expect(hourPrefix('sky01', new Date('2026-09-22T23:59:59Z'))).toBe('raw/cam=sky01/date=2026-09-22/hour=23/');
  });
});
