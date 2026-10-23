import { buildRackSegments, compactSegments, occupiedRange } from '../../src/client/features/racks/rack-layout';
import type { TopologyBoxDto } from '../../src/shared/api/v1/topology';

function box(u: number, height = 1): TopologyBoxDto {
  return { u, height, label: `box-${u}`, nodes: [] };
}

describe('buildRackSegments', () => {
  test('merges a run of empty units into one segment instead of one per unit', () => {
    // Occupied at u=3 (height 2) and u=10, over range 1-12: empty runs at
    // 1-2, 5-9, and 11-12.
    const segments = buildRackSegments([box(3, 2), box(10)], { start: 1, end: 12 });

    expect(segments).toEqual([
      { kind: 'empty', u: 1, height: 2 },
      { kind: 'box', box: box(3, 2) },
      { kind: 'empty', u: 5, height: 5 },
      { kind: 'box', box: box(10) },
      { kind: 'empty', u: 11, height: 2 },
    ]);
  });

  test('a fully occupied range has no empty segments', () => {
    const segments = buildRackSegments([box(1, 2), box(3, 2)], { start: 1, end: 4 });
    expect(segments.every((segment) => segment.kind === 'box')).toBe(true);
  });

  test('a rack with no boxes is a single empty segment spanning the range', () => {
    expect(buildRackSegments([], { start: 1, end: 10 })).toEqual([{ kind: 'empty', u: 1, height: 10 }]);
  });

  test('segment heights sum to the range length', () => {
    const range = { start: 1, end: 42 };
    const segments = buildRackSegments([box(3, 4), box(9, 4), box(21)], range);
    const total = segments.reduce(
      (sum, segment) => sum + (segment.kind === 'box' ? segment.box.height : segment.height),
      0,
    );
    expect(total).toBe(range.end - range.start + 1);
  });

  test('a range narrower than the rack (compact density) only covers the occupied span', () => {
    const boxes = [box(3, 2), box(8)];
    const range = occupiedRange(boxes)!;
    const segments = buildRackSegments(boxes, range);

    expect(range).toEqual({ start: 3, end: 8 });
    // No leading/trailing empty padding outside the occupied span.
    expect(segments[0]).toEqual({ kind: 'box', box: box(3, 2) });
    expect(segments.at(-1)).toEqual({ kind: 'box', box: box(8) });
  });
});

describe('compactSegments', () => {
  test('collapses an empty run taller than 1U down to 1U', () => {
    const segments = buildRackSegments([box(3, 2), box(10)], { start: 1, end: 12 });
    expect(compactSegments(segments)).toEqual([
      { kind: 'empty', u: 1, height: 1 },
      { kind: 'box', box: box(3, 2) },
      { kind: 'empty', u: 5, height: 1 },
      { kind: 'box', box: box(10) },
      { kind: 'empty', u: 11, height: 1 },
    ]);
  });

  test('leaves an existing 1U gap alone', () => {
    const segments = buildRackSegments([box(1), box(3)], { start: 1, end: 3 });
    expect(compactSegments(segments)).toEqual(segments);
  });

  test('leaves box segments untouched', () => {
    const segments = buildRackSegments([box(1, 4)], { start: 1, end: 4 });
    expect(compactSegments(segments)).toEqual(segments);
  });
});

describe('occupiedRange', () => {
  test('spans from the lowest box start to the highest box top', () => {
    expect(occupiedRange([box(3, 2), box(10)])).toEqual({ start: 3, end: 10 });
  });

  test('is null for a rack with no boxes', () => {
    expect(occupiedRange([])).toBeNull();
  });
});
