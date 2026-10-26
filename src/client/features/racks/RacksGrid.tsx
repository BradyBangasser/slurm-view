import { Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Legend } from './Legend.tsx';
import { NodeDetailPanel } from './NodeDetailPanel.tsx';
import { RackColumn } from './RackColumn.tsx';
import type { ColorMode, LoadScale } from './rack-color.ts';
import { nodeColorClass, nodeColorLabel, nodeColorStyle } from './rack-color.ts';
import type { RackDensity } from './rack-density.ts';
import { RacksFilters } from './RacksFilters.tsx';
import { nodeMatches } from './rack-filters.ts';
import type { RackFilters } from './rack-filters.ts';
import type { TopologyNodeDto, TopologyRackDto } from '../../../shared/api/v1/topology.ts';

interface RacksGridRack {
  rack: TopologyRackDto;
  // Shown as a small badge above the rack id. Set in the combined view,
  // where racks from several pods sit side by side; omitted in a
  // single-pod view, where this component's own `title` already names the
  // pod.
  podName?: string;
}

// Dotted graph-paper backdrop behind the rack elevations / flat node grid,
// like FigJam's canvas — a visual cue that this area is a spatial layout,
// not just a list. A 20px pitch roughly matches RackColumn's node-box
// grain, so the dots read as a grid the boxes sit on rather than a random
// texture.
const DOTTED_GRID_STYLE = {
  backgroundImage: 'radial-gradient(circle, rgba(100,116,139,0.4) 1.5px, transparent 1.5px)',
  backgroundSize: '20px 20px',
};

// Everything RacksGrid needs that ISN'T specific to which racks/nodes it's
// showing: the filter/color/density state and callbacks, plus the
// legend/selection/detail-panel wiring. Factored out so PodView.tsx — which
// computes `racks` and `title` for whichever tab is active (a pod, the
// combined cross-pod view, or Unplaced) — can take `RacksGridControlsProps`
// and forward it with a single `{...controls}` instead of listing it all
// inline.
interface RacksGridControlsProps {
  density: RackDensity;
  onDensityChange: (density: RackDensity) => void;
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
  // Thresholds + step count the load color mode grades `cpuLoadRatio`
  // against (from `TopologyResponse.loadThresholds`/`loadGradientSteps`).
  loadScale: LoadScale;
  search: string;
  onSearchChange: (value: string) => void;
  filters: RackFilters;
  onFiltersChange: (filters: RackFilters) => void;
  partitions: string[];

  // Legend counts are topology-wide (every node, not just the ones in this
  // particular rack/flat view), matching the pre-refactor behavior where
  // the legend sat outside any single pod's content.
  legendNodes: TopologyNodeDto[];
  activeNode: TopologyNodeDto | null;
  onSelect: (node: TopologyNodeDto) => void;
  onCloseDetail: () => void;
}

interface RacksGridProps extends RacksGridControlsProps {
  // Heading shown above the content, inside the same fullscreen-able box
  // (e.g. "Compute pod (12 racks)", "All pods, combined (19 racks)",
  // "Unplaced nodes") — PodView.tsx computes this per active tab.
  title: string;
  // Rack-elevation mode when non-empty. When empty, `flatNodes` renders
  // instead as a dense button grid — used for the Unplaced-only tab and
  // the "no layout configured" fallback, where there's nothing to draw as
  // racks but the same filters/legend/detail/fullscreen shell still
  // applies.
  racks: RacksGridRack[];
  flatNodes?: TopologyNodeDto[];
  flatNodesDescription?: string;
  rackHeight: number;
  // A single pod's racks scroll horizontally in one row by default (the
  // original single-pod-view behavior), unless maxRacksPerRow forces a wrap
  // instead (see below). The combined view always wraps, since it can hold
  // far more racks than fit in one row and "pulled together" reads better
  // as a block than as one very long strip.
  wrap?: boolean;
  // The user's saved "racks per row" preference (ui-settings'
  // topology.maxRacksPerRow). Enforced with CSS Grid
  // (`grid-template-columns: repeat(N, max-content)`), not by estimating a
  // pixel width: a rack's actual rendered footprint is wider than just its
  // bay (RackColumn.tsx adds rail posts, a border and padding around that
  // bay), so a hand-computed width reliably undercounts how many racks
  // actually fit. Grid auto-flows onto a new row once a row's N cells are
  // full, sized to each rack's real rendered width.
  maxRacksPerRow?: number;
  // The pod/combined/unplaced tablist (PodView.tsx), rendered inside the
  // canvas above the title so switching tabs — including into and out of
  // the combined view — doesn't require leaving it, and this one RacksGrid
  // instance (and its fullscreen state) survives every tab switch.
  tabsSlot?: ReactNode;
}

// The rack elevation (or flat node grid), its own fullscreen toggle, and
// its filter/legend/detail sidebar, all as one self-contained unit. This
// used to be three separate pieces — RacksSection's always-visible
// horizontal filter bar, and two near-identical wrapper components
// (RacksTabs, CombinedRacksView) each rebuilding the same grid + sticky
// detail column — which made "let this one view go fullscreen" awkward:
// there was no single element that was just "the rack view" to expand.
// Folding the filters and the fullscreen toggle into this component means
// switching pod tabs (rendered here via tabsSlot, state owned one level up
// in PodView.tsx) doesn't touch this component's fullscreen state, and
// entering fullscreen takes the tab bar with it along with everything else.
function RacksGrid({
  title,
  racks,
  flatNodes,
  flatNodesDescription,
  rackHeight,
  wrap = false,
  maxRacksPerRow,
  tabsSlot,
  density,
  onDensityChange,
  colorMode,
  onColorModeChange,
  loadScale,
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  partitions,
  legendNodes,
  activeNode,
  onSelect,
  onCloseDetail,
}: RacksGridProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Keeps isFullscreen in sync when the real Fullscreen API is used and the
  // browser exits it on its own (Escape, or any other UA gesture) rather
  // than through our own button.
  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Escape-to-exit for the CSS-fallback path only (see toggleFullscreen):
  // the real Fullscreen API already handles Escape on its own.
  useEffect(() => {
    if (!isFullscreen || document.fullscreenElement) {
      return undefined;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsFullscreen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  function toggleFullscreen() {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    if (document.fullscreenElement === container) {
      void document.exitFullscreen();
      return;
    }
    if (container.requestFullscreen) {
      container.requestFullscreen().catch(() => {
        // Fullscreen API present but refused (e.g. an embedding iframe
        // without `allowfullscreen`, or a thin-client/kiosk policy) — fall
        // back to a viewport-filling CSS mode rather than doing nothing.
        setIsFullscreen(true);
      });
      return;
    }
    // No Fullscreen API at all (older browser). Same CSS fallback.
    setIsFullscreen((prev) => !prev);
  }

  const filtering = search.trim() !== '' || filters.status !== 'all' || filters.partition !== 'all';
  const matchCount = legendNodes.filter((node) => nodeMatches(node, search, filters)).length;

  const layoutClassName = maxRacksPerRow !== undefined ? 'grid' : `flex ${wrap ? 'flex-wrap' : ''}`;

  let mainContent;
  if (racks.length > 0) {
    mainContent = (
      <div
        className={`rack-layout min-w-0 gap-4 ${layoutClassName}`}
        style={
          maxRacksPerRow !== undefined ? { gridTemplateColumns: `repeat(${maxRacksPerRow}, max-content)` } : undefined
        }
      >
        {racks.map(({ rack, podName }) => (
          <RackColumn
            key={podName !== undefined ? `${podName}/${rack.id}` : rack.id}
            rack={rack}
            rackHeight={rackHeight}
            density={density}
            colorMode={colorMode}
            loadScale={loadScale}
            search={search}
            filters={filters}
            activeNode={activeNode}
            onSelect={onSelect}
            podName={podName}
          />
        ))}
      </div>
    );
  } else if (flatNodes !== undefined && flatNodes.length > 0) {
    mainContent = (
      <div className="min-w-0">
        {flatNodesDescription !== undefined ? (
          <p className="mb-2 text-sm text-gray-500">{flatNodesDescription}</p>
        ) : null}
        <div className="flex flex-wrap gap-1" role="list" aria-label={title}>
          {flatNodes.map((node) => {
            const matches = nodeMatches(node, search, filters);
            const active = node.name === activeNode?.name;
            const searching = search.trim() !== '';
            return (
              <button
                key={node.name}
                type="button"
                role="listitem"
                aria-label={`${node.name}: ${nodeColorLabel(node, colorMode, loadScale)}`}
                aria-pressed={active}
                onClick={() => onSelect(node)}
                style={nodeColorStyle(node, colorMode, loadScale)}
                className={`h-8 w-28 truncate rounded-sm border border-black/10 px-1.5 text-left text-xs font-mono text-slate-900 outline-none transition-colors hover:brightness-95 focus-visible:ring-2 focus-visible:ring-sky-400 ${nodeColorClass(node, colorMode)} ${matches ? '' : 'opacity-20 saturate-50'} ${searching && matches ? 'ring-2 ring-sky-400' : ''} ${active ? 'ring-2 ring-slate-900' : ''}`}
              >
                {node.name}
              </button>
            );
          })}
        </div>
      </div>
    );
  } else {
    mainContent = <p className="text-sm text-gray-500">No nodes here.</p>;
  }

  return (
    // This div — the dotted-grid canvas — is the thing that goes fullscreen.
    // Its header (title + fullscreen toggle + match-count banner) and the
    // filters/legend/detail sidebar all live inside it, so entering
    // fullscreen takes the whole rack view with it rather than leaving
    // those controls behind in the page underneath.
    <div
      ref={containerRef}
      className={`rack-scroll overflow-auto overscroll-contain rounded-lg bg-slate-50 ${
        isFullscreen ? 'fixed inset-0 z-50 p-5' : 'max-h-[560px] p-4'
      }`}
      style={DOTTED_GRID_STYLE}
    >
      {/*
        Tabs (when present) and the fullscreen toggle share one row at the
        top right of the canvas, so the toggle reads as acting on the whole
        canvas rather than on whichever tab happens to be active.
      */}
      <div className={`mb-3 flex items-center justify-between gap-2 ${tabsSlot ? 'border-b border-gray-200' : ''}`}>
        {tabsSlot}
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-pressed={isFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          className="shrink-0 rounded border border-gray-300 bg-white p-1.5 text-gray-700 hover:bg-gray-50"
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>

      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      </div>

      {filtering ? (
        <p className="mb-3 inline-flex items-center rounded-full bg-sky-50 px-3 py-1 text-sm font-medium text-sky-700" role="status">
          {matchCount} of {legendNodes.length} nodes match
        </p>
      ) : null}

      <div className="flex items-start gap-4">
        {/*
          flex-1 so this takes all the width left over after the sidebar's
          fixed 260px, and justify-center so the rack strip (or flat node
          grid) centers within *that* space rather than the whole canvas —
          centering against the canvas width would look off-center once the
          sidebar is factored in. min-w-0 lets it shrink below its content's
          width so the rack strip still scrolls horizontally instead of
          pushing the sidebar out.
        */}
        <div className="flex min-w-0 flex-1 justify-center">{mainContent}</div>

        {/*
          Pinned to the canvas's own right edge via `sticky` + `right-0`:
          the canvas (this component's root) is the scrolling container, so
          as the rack strip scrolls horizontally underneath, this panel
          stays put on the right rather than scrolling away as if it were
          just another column.
        */}
        <div className="sticky right-2 top-0 ml-auto flex w-[260px] flex-shrink-0 flex-col gap-3 self-start rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <RacksFilters
            search={search}
            onSearchChange={onSearchChange}
            filters={filters}
            onFiltersChange={onFiltersChange}
            partitions={partitions}
            colorMode={colorMode}
            onColorModeChange={onColorModeChange}
            density={density}
            onDensityChange={onDensityChange}
          />
          <Legend nodes={legendNodes} colorMode={colorMode} loadScale={loadScale} />
          <NodeDetailPanel node={activeNode} onClose={onCloseDetail} />
        </div>
      </div>
    </div>
  );
}

export { RacksGrid, DOTTED_GRID_STYLE };
export type { RacksGridRack, RacksGridControlsProps };
