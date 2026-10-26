import { useState } from 'react';
import { NodeGrid } from './NodeGrid.tsx';
import { RacksGrid } from './RacksGrid.tsx';
import type { RacksGridControlsProps } from './RacksGrid.tsx';
import type { ColorMode, LoadScale } from './rack-color.ts';
import { DEFAULT_RACK_DENSITY } from './rack-density.ts';
import type { RackDensity } from './rack-density.ts';
import { allNodes, DEFAULT_RACK_FILTERS, partitionsIn } from './rack-filters.ts';
import { sortByRackOrder } from './rack-order.ts';
import type { TopologyNodeDto, TopologyRackDto, TopologyResponse } from '../../../shared/api/v1/topology.ts';

// Synthetic tab ids alongside each pod's name.
const COMBINED_TAB = 'combined';
const UNPLACED_TAB = 'unplaced';
type SectionTab = string;

interface PodViewProps {
  topology: TopologyResponse;
  // Per-user ui-settings preferences (Settings page); see RacksGrid.tsx for
  // how maxRacksPerRow is enforced and rack-order.ts for rackOrder.
  maxRacksPerRow?: number;
  rackOrder?: string[];
}

// The pod/unplaced tabs, plus whichever single RacksGrid is currently
// active (one pod's, the combined cross-pod view, or the flat Unplaced
// list) — see RacksGrid.tsx for the filters/legend/detail/fullscreen shell
// that lives inside each one. This component owns only the state that
// needs to survive a tab switch (search, filters, color mode, density,
// node selection); RacksGrid owns everything about how one view of the
// racks is drawn and controlled.
function PodView({ topology, maxRacksPerRow, rackOrder }: PodViewProps) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(DEFAULT_RACK_FILTERS);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('status');
  const [density, setDensity] = useState<RackDensity>(DEFAULT_RACK_DENSITY);
  const [activeTab, setActiveTab] = useState<SectionTab | null>(null);

  const legendNodes = allNodes(topology);
  const selectedNode: TopologyNodeDto | null = legendNodes.find((node) => node.name === selectedName) ?? null;
  const combinedViewAvailable = topology.pods.length > 1;
  const loadScale: LoadScale = { thresholds: topology.loadThresholds, steps: topology.loadGradientSteps };

  const tabs: { id: SectionTab; label: string }[] = [
    ...topology.pods.map((pod) => ({ id: pod.name, label: `${pod.name} pod` })),
    ...(topology.unplaced.length > 0 ? [{ id: UNPLACED_TAB, label: 'Unplaced' }] : []),
    ...(combinedViewAvailable ? [{ id: COMBINED_TAB, label: 'Combined view' }] : []),
  ];
  const resolvedTab = activeTab !== null && tabs.some((tab) => tab.id === activeTab) ? activeTab : (tabs[0]?.id ?? null);
  const showCombined = resolvedTab === COMBINED_TAB;
  const activePod = topology.pods.find((pod) => pod.name === resolvedTab);

  // Racks/title for whichever tab is active, computed inline for all three
  // cases (a pod, the combined cross-pod view, Unplaced) rather than
  // behind separate wrapper components, so a tab switch always renders
  // the *same* RacksGrid element: swapping component types at this tree
  // position would unmount/remount the canvas and, with it, drop
  // fullscreen (both our own isFullscreen state and the real
  // Element.requestFullscreen, which exits automatically when its element
  // leaves the DOM).
  let racks: { rack: TopologyRackDto; podName?: string }[];
  let title: string;
  if (showCombined) {
    const gridSorted = topology.pods
      .flatMap((pod) => pod.racks.map((rack) => ({ rack, podName: pod.name })))
      .sort((a, b) => a.podName.localeCompare(b.podName) || (a.rack.grid?.column ?? 0) - (b.rack.grid?.column ?? 0));
    racks = sortByRackOrder(gridSorted, rackOrder ?? []);
    title = `All pods, combined (${racks.length} racks)`;
  } else if (activePod !== undefined) {
    racks = sortByRackOrder(
      [...activePod.racks].sort((a, b) => (a.grid?.column ?? 0) - (b.grid?.column ?? 0)).map((rack) => ({ rack })),
      rackOrder ?? [],
    );
    title = `${activePod.name} pod (${racks.length} racks)`;
  } else {
    racks = [];
    title = 'Unplaced nodes';
  }

  // Everything RacksGrid needs that isn't specific to which racks it's
  // showing.
  const controls: RacksGridControlsProps = {
    density,
    onDensityChange: setDensity,
    colorMode,
    onColorModeChange: setColorMode,
    loadScale,
    search,
    onSearchChange: setSearch,
    filters,
    onFiltersChange: setFilters,
    partitions: partitionsIn(topology),
    legendNodes,
    activeNode: selectedNode,
    onSelect: (node) => setSelectedName(node.name),
    onCloseDetail: () => setSelectedName(null),
  };

  // Rendered inside RacksGrid's canvas, in the same row as the fullscreen
  // toggle (top right of the canvas), rather than above the whole
  // component, so switching sections — including into and out of Combined
  // view, now a tab itself — doesn't mean leaving the canvas. RacksGrid
  // supplies the row's shared border/spacing; this is just the tablist
  // itself.
  const tabsSlot =
    tabs.length > 1 ? (
      <div role="tablist" aria-label="Rack sections" className="flex gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === resolvedTab}
            onClick={() => setActiveTab(tab.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab.id === resolvedTab
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div>
      <RacksGrid
        title={title}
        racks={racks}
        flatNodes={!showCombined && activePod === undefined ? topology.unplaced : undefined}
        flatNodesDescription={
          !showCombined && activePod === undefined && topology.configured
            ? 'Reported by Slurm but not in the rack layout.'
            : undefined
        }
        rackHeight={topology.rackHeight}
        wrap={showCombined}
        maxRacksPerRow={maxRacksPerRow}
        tabsSlot={tabsSlot}
        {...controls}
      />
      {showCombined ? (
        <NodeGrid
          title="Unplaced nodes"
          description={topology.configured ? 'Reported by Slurm but not in the rack layout.' : undefined}
          nodes={topology.unplaced}
          colorMode={colorMode}
          loadScale={loadScale}
          search={search}
          filters={filters}
          activeNode={selectedNode}
          onSelect={controls.onSelect}
        />
      ) : null}
    </div>
  );
}

export { PodView };
