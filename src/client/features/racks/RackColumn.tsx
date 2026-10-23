import { RackBox } from './RackBox.tsx';
import type { ColorMode } from './rack-color.ts';
import type { RackDensity } from './rack-density.ts';
import { RACK_WIDTH_PX, UNIT_HEIGHT_PX } from './rack-density.ts';
import { buildRackSegments, compactSegments, occupiedRange } from './rack-layout.ts';
import type { RackFilters } from './rack-filters.ts';
import type { TopologyNodeDto, TopologyRackDto } from '../../../shared/api/v1/topology.ts';

interface RackColumnProps {
  rack: TopologyRackDto;
  rackHeight: number;
  density: RackDensity;
  colorMode: ColorMode;
  search: string;
  filters: RackFilters;
  activeNode: TopologyNodeDto | null;
  onSelect: (node: TopologyNodeDto) => void;
}

// One physical rack: boxes stacked bottom-up by unit position, with empty
// runs filled in as single merged blocks so it reads as a continuous
// enclosure. "full" density draws every rack to the full rackHeight, so
// racks in a pod share one scale; "compact" trims to just the occupied
// span (see rack-layout.ts's occupiedRange), draws at a smaller unit
// size (rack-density.ts), and collapses any internal empty run taller
// than 1U down to 1U while leaving existing 1U gaps alone (Meeting 5's
// compaction rule — see rack-layout.ts's compactSegments). Styled as a dark rack with its own rail posts,
// so it reads as hardware rather than a plain list. `shrink-0` so it
// holds its width in the pod's horizontal-scrolling strip (see
// PodSection.tsx) — deliberately no scroll-snap there, since mandatory
// snapping across many wide racks fights scroll momentum and feels laggy
// rather than smooth.
function RackColumn({ rack, rackHeight, density, colorMode, search, filters, activeNode, onSelect }: RackColumnProps) {
  const range = density === 'compact' ? occupiedRange(rack.boxes) ?? { start: 1, end: rackHeight } : { start: 1, end: rackHeight };
  // Segments come back bottom-up (unit 1 first); the rack's physical top is
  // its highest unit, so render in reverse for a top-down DOM order.
  const rawSegments = buildRackSegments(rack.boxes, range);
  const segments = [...(density === 'compact' ? compactSegments(rawSegments) : rawSegments)].reverse();
  const unitHeightPx = UNIT_HEIGHT_PX[density];
  return (
    <figure className="flex shrink-0 flex-col items-center gap-0">
      <figcaption className="mb-1.5 flex items-center gap-1.5 rounded-full bg-slate-800 px-3 py-0.5 text-xs font-semibold tracking-wide text-slate-100 shadow">
        {rack.id}
        {density === 'compact' ? (
          <span className="font-normal text-slate-400">
            U{range.start}–U{range.end}
          </span>
        ) : null}
      </figcaption>
      <div
        className="flex gap-1 rounded-md border border-slate-900 bg-slate-800 p-1"
        role="list"
        aria-label={`Rack ${rack.id}`}
      >
        <div className="w-1 shrink-0 bg-slate-950" aria-hidden="true" />
        <div className="flex flex-col" style={{ width: RACK_WIDTH_PX[density] }}>
          {segments.map((segment) =>
            segment.kind === 'box' ? (
              <div key={segment.box.u} role="listitem" style={{ height: segment.box.height * unitHeightPx }}>
                <RackBox
                  box={segment.box}
                  colorMode={colorMode}
                  search={search}
                  filters={filters}
                  activeNode={activeNode}
                  onSelect={onSelect}
                />
              </div>
            ) : (
              <div
                key={`empty-${segment.u}`}
                aria-hidden="true"
                className="border border-dashed border-slate-700/60 bg-slate-800"
                style={{ height: segment.height * unitHeightPx }}
              />
            ),
          )}
        </div>
        <div className="w-1 shrink-0 bg-slate-950" aria-hidden="true" />
      </div>
    </figure>
  );
}

export { RackColumn };
