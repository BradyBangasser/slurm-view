import type { TopologyBoxDto } from '../../../shared/api/v1/topology.ts';

type RackSegment = { kind: 'box'; box: TopologyBoxDto } | { kind: 'empty'; u: number; height: number };

interface UnitRange {
  start: number;
  end: number;
}

// The unit span a rack's boxes actually occupy (lowest box's u through the
// highest box's top). Null for a rack with no boxes, so callers can fall
// back to the full rackHeight rather than render nothing.
function occupiedRange(boxes: TopologyBoxDto[]): UnitRange | null {
  if (boxes.length === 0) {
    return null;
  }
  return {
    start: Math.min(...boxes.map((box) => box.u)),
    end: Math.max(...boxes.map((box) => box.u + box.height - 1)),
  };
}

// Fills the gaps between configured boxes with empty segments, across
// `range` (inclusive), so the rack elevation renders as a continuous
// enclosure. Consecutive empty units are merged into one segment (height >
// 1) rather than one DOM node per unit: a sparsely-populated 42U rack could
// otherwise render dozens of individually-bordered 1U divs that add up
// across a whole pod and make scrolling feel heavy for no visual gain — a
// merged block with the same dashed border looks identical to a stack of
// them, since neither draws anything but the outer edge. Returns
// bottom-up (u ascending); callers render top-down for display, since a
// rack's top is its highest unit.
function buildRackSegments(boxes: TopologyBoxDto[], range: UnitRange): RackSegment[] {
  const byStartU = new Map(boxes.map((box) => [box.u, box]));
  const segments: RackSegment[] = [];
  let u = range.start;
  while (u <= range.end) {
    const box = byStartU.get(u);
    if (box) {
      segments.push({ kind: 'box', box });
      u += box.height;
      continue;
    }
    const emptyStart = u;
    while (u <= range.end && !byStartU.has(u)) {
      u += 1;
    }
    segments.push({ kind: 'empty', u: emptyStart, height: u - emptyStart });
  }
  return segments;
}

// Meeting 5 compaction rule: in compact density, an empty run taller than
// 1U reads as dead air and gets collapsed down to a single unit, while an
// existing 1U gap is left alone (it's already a minimal spacer, not
// something to shrink further). Only empty segments are touched — boxes
// keep their real height, since compact density already got its space
// savings from trimming outside the occupied range (see occupiedRange).
function compactSegments(segments: RackSegment[]): RackSegment[] {
  return segments.map((segment) => (segment.kind === 'empty' && segment.height > 1 ? { ...segment, height: 1 } : segment));
}

export { buildRackSegments, compactSegments, occupiedRange };
export type { RackSegment, UnitRange };
