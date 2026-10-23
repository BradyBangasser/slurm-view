import { RackColumn } from './RackColumn.tsx';
import type { ColorMode } from './rack-color.ts';
import type { RackDensity } from './rack-density.ts';
import type { RackFilters } from './rack-filters.ts';
import type { TopologyNodeDto, TopologyPodDto } from '../../../shared/api/v1/topology.ts';

interface PodSectionProps {
  pod: TopologyPodDto;
  rackHeight: number;
  density: RackDensity;
  colorMode: ColorMode;
  search: string;
  filters: RackFilters;
  activeNode: TopologyNodeDto | null;
  onSelect: (node: TopologyNodeDto) => void;
}

// Racks within one pod (e.g. "GPU", "Compute"), ordered by floor column
// when the rack id parses as a grid cell. A bounded box with its own
// scrollbars in both directions — horizontal because a pod can have more
// racks than fit across, vertical as a safety net for "full" density,
// where every rack draws to the full rackHeight (42U, see RackColumn) and
// can be taller than the screen. "compact" density usually doesn't need
// the vertical scrollbar at all, since racks are trimmed to their
// occupied span, but the cap stays in both modes in case a single rack is
// still tall.
//
// No scroll-snap: mandatory snapping across several wide racks fights
// scroll momentum (especially on a trackpad) and reads as laggy rather
// than smooth, so this is plain native scrolling. `rack-scroll` (index.css)
// restyles the scrollbar itself to the app's sky/slate palette instead of
// the browser default, which clashed with the dark rack figures inside it.
//
// `min-w-0` is load-bearing here, not decoration: a flex/grid item's
// default automatic minimum width is based on its content's size, so
// without it this container would refuse to shrink below the total width
// of every rack side by side and grow the page instead of scrolling. With
// it, the container is clamped to its slot's width and `overflow-auto`
// on the row below actually gets to do its job.
function PodSection({ pod, rackHeight, density, colorMode, search, filters, activeNode, onSelect }: PodSectionProps) {
  const racks = [...pod.racks].sort((a, b) => (a.grid?.column ?? 0) - (b.grid?.column ?? 0));
  return (
    <section className="mt-6 min-w-0">
      <h3 className="text-sm font-semibold text-gray-700">
        {pod.name} pod <span className="font-normal text-gray-400">({racks.length} racks)</span>
      </h3>
      <div className="rack-scroll mt-2 flex min-w-0 max-h-[560px] gap-4 overflow-auto overscroll-contain rounded-lg bg-slate-900/5 p-4">
        {racks.map((rack) => (
          <RackColumn
            key={rack.id}
            rack={rack}
            rackHeight={rackHeight}
            density={density}
            colorMode={colorMode}
            search={search}
            filters={filters}
            activeNode={activeNode}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

export { PodSection };
