import { describe, expect, it } from 'vitest';
import { pageRange } from '../src/components/pagination';

describe('pageRange', () => {
  it('shows every page when the range is small', () => {
    expect(pageRange(6, 3)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('keeps first and last pages plus current neighbors without duplicate pages', () => {
    expect(pageRange(20, 10)).toEqual([1, 2, 3, 'ellipsis', 9, 10, 11, 'ellipsis', 18, 19, 20]);
  });

  it('does not add unnecessary ellipses near either edge', () => {
    expect(pageRange(20, 2)).toEqual([1, 2, 3, 'ellipsis', 18, 19, 20]);
    expect(pageRange(20, 19)).toEqual([1, 2, 3, 'ellipsis', 18, 19, 20]);
  });
});
