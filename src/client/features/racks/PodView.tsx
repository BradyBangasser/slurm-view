import { useState } from 'react';
import { CombinedRacksSection } from './CombinedRacksSection.tsx';
import { NodeGrid } from './NodeGrid.tsx';
import { PodSection } from './PodSection.tsx';
import { RacksGrid } from './RacksGrid.tsx';
import type { RacksGridControlsProps } from './RacksGrid.tsx';
import type { ColorMode } from './rack-color.ts';
import { DEFAULT_RACK_DENSITY } from './rack-density.ts';
import type { RackDensity } from './rack-density.ts';
import { allNodes, DEFAULT_RACK_FILTERS, partitionsIn } from './rack-filters.ts';
import type { TopologyNodeDto, TopologyResponse } from '../../../shared/api/v1/topology.ts';

// 'unplaced' is a synthetic tab id alongside each pod's name. "Combined" has
// no tab of its own — it's a layout toggle inside RacksGrid's filter
// column, not a sibling of the pods, so it isn't a member of this type.
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
// combined-view toggle, node selection); RacksGrid owns everything about
// how one view of the racks is drawn and controlled.
function PodView({ topology, maxRacksPerRow, rackOrder }: PodViewProps) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(DEFAULT_RACK_FILTERS);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('status');
  const [density, setDensity] = useState<RackDensity>(DEFAULT_RACK_DENSITY);
  const [activeTab, setActiveTab] = useState<SectionTab | null>(null);
  const [combinedView, setCombinedView] = useState(false);

  const legendNodes = allNodes(topology);
  const selectedNode: TopologyNodeDto | null = legendNodes.find((node) => node.name === selectedName) ?? null;
  const combinedViewAvailable = topology.pods.length > 1;
  const showCombined = combinedView && combinedViewAvailable;

  const tabs: { id: SectionTab; label: string }[] = [
    ...topology.pods.map((pod) => ({ id: pod.name, label: `${pod.name} pod` })),
    ...(topology.unplaced.length > 0 ? [{ id: UNPLACED_TAB, label: 'Unplaced' }] : []),
  ];
  const resolvedTab = activeTab !== null && tabs.some((tab) => tab.id === activeTab) ? activeTab : (tabs[0]?.id ?? null);
  const activePod = topology.pods.find((pod) => pod.name === resolvedTab);

  // Everything RacksGrid needs that isn't specific to which racks it's
  // showing — passed as one object to whichever of PodSection /
  // CombinedRacksSection / RacksGrid is rendered below.
  const controls: RacksGridControlsProps = {
    density,
    onDensityChange: setDensity,
    colorMode,
    onColorModeChange: setColorMode,
    search,
    onSearchChange: setSearch,
    filters,
    onFiltersChange: setFilters,
    partitions: partitionsIn(topology),
    combinedView,
    onCombinedViewChange: setCombinedView,
    combinedViewAvailable,
    legendNodes,
    activeNode: selectedNode,
    onSelect: (node) => setSelectedName(node.name),
    onCloseDetail: () => setSelectedName(null),
  };

  // Rendered inside RacksGrid's canvas (above its title) rather than above
  // the whole component, so switching sections doesn't mean leaving the
  // canvas. Hidden in the combined view, which has no tabs of its own.
  const tabsSlot =
    !showCombined && tabs.length > 1 ? (
      <div role="tablist" aria-label="Rack sections" className="mb-3 flex gap-1 border-b border-gray-200">
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
      {showCombined ? (
        <>
          <CombinedRacksSection
            pods={topology.pods}
            rackHeight={topology.rackHeight}
            maxRacksPerRow={maxRacksPerRow}
            rackOrder={rackOrder}
            {...controls}
          />
          <NodeGrid
            title="Unplaced nodes"
            description={topology.configured ? 'Reported by Slurm but not in the rack layout.' : undefined}
            nodes={topology.unplaced}
            colorMode={colorMode}
            search={search}
            filters={filters}
            activeNode={selectedNode}
            onSelect={controls.onSelect}
          />
        </>
      ) : activePod !== undefined ? (
        <PodSection
          pod={activePod}
          rackHeight={topology.rackHeight}
          maxRacksPerRow={maxRacksPerRow}
          rackOrder={rackOrder}
          tabsSlot={tabsSlot}
          {...controls}
        />
      ) : (
        <RacksGrid
          title="Unplaced nodes"
          racks={[]}
          flatNodes={topology.unplaced}
          flatNodesDescription={topology.configured ? 'Reported by Slurm but not in the rack layout.' : undefined}
          rackHeight={topology.rackHeight}
          tabsSlot={tabsSlot}
          {...controls}
        />
      )}
    </div>
  );
}

export { PodView };
