import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { fetchTopology } from '../../api/topology.ts';
import { topologyKeys } from '../../api/query-keys.ts';
import { ErrorPanel } from '../../components/ErrorPanel.tsx';
import { RefreshWarning } from '../../components/RefreshWarning.tsx';
import { Legend } from './Legend.tsx';
import { NodeDetailPanel } from './NodeDetailPanel.tsx';
import { NodeGrid } from './NodeGrid.tsx';
import { PodSection } from './PodSection.tsx';
import type { ColorMode } from './rack-color.ts';
import { DEFAULT_RACK_DENSITY } from './rack-density.ts';
import type { RackDensity } from './rack-density.ts';
import { RacksFilters } from './RacksFilters.tsx';
import { allNodes, DEFAULT_RACK_FILTERS, nodeMatches, partitionsIn } from './rack-filters.ts';
import type { RackFilters } from './rack-filters.ts';
import type { TopologyNodeDto, TopologyResponse } from '../../../shared/api/v1/topology.ts';

function RacksSkeleton() {
  return (
    <div className="flex items-center justify-center p-8" aria-busy="true" aria-label="Loading rack layout">
      <div className="h-48 w-full max-w-3xl animate-pulse rounded-lg bg-gray-200" />
    </div>
  );
}

// 'unplaced' is a synthetic tab id alongside each pod's name.
type SectionTab = string;

function RacksSection() {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(DEFAULT_RACK_FILTERS);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('status');
  const [density, setDensity] = useState<RackDensity>(DEFAULT_RACK_DENSITY);
  const [activeTab, setActiveTab] = useState<SectionTab | null>(null);

  // Same cadence as the NodesCache TTL it reads: see CLAUDE.md's cache
  // table. Explicitly live, like stats and jobs — no focus/reconnect
  // refetch (project defaults), but a fresh poll every 15s and on remount.
  const topologyQuery = useQuery({
    queryKey: topologyKeys.detail,
    queryFn: ({ signal }) => fetchTopology({ signal }),
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchOnMount: true,
  });

  if (topologyQuery.data === undefined) {
    if (topologyQuery.isPending) {
      return (
        <div id="node-status" className="mb-12 scroll-mt-24">
          <h2 className="mb-6 text-2xl font-semibold">Node Status</h2>
          <RacksSkeleton />
        </div>
      );
    }
    return (
      <div id="node-status" className="mb-12 scroll-mt-24">
        <h2 className="mb-6 text-2xl font-semibold">Node Status</h2>
        <ErrorPanel message={errorMessage(topologyQuery.error)} onRetry={() => void topologyQuery.refetch()} />
      </div>
    );
  }

  const topology = topologyQuery.data;
  const nodes = allNodes(topology);
  const selectedNode: TopologyNodeDto | null = nodes.find((node) => node.name === selectedName) ?? null;
  const filtering = search.trim() !== '' || filters.status !== 'all' || filters.partition !== 'all';
  const matchCount = nodes.filter((node) => nodeMatches(node, search, filters)).length;

  return (
    <div id="node-status" className="mb-12 scroll-mt-24">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold">Node Status</h2>
        <div className="flex items-center gap-3 text-sm text-gray-600">
          {topologyQuery.isFetching ? <span aria-live="polite">Refreshing…</span> : null}
          <span>Last updated: {new Date(topology.updatedAt).toLocaleTimeString()}</span>
        </div>
      </div>

      {topologyQuery.isError ? (
        <div className="mb-4">
          <RefreshWarning
            message="Showing the previous node layout because the latest refresh failed."
            onRetry={() => void topologyQuery.refetch()}
          />
        </div>
      ) : null}

      {!topology.configured ? (
        <p className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800" role="status">
          No rack layout is configured for this site, so nodes are shown as a flat list
          rather than their physical positions.
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <RacksFilters
          search={search}
          onSearchChange={setSearch}
          filters={filters}
          onFiltersChange={setFilters}
          partitions={partitionsIn(topology)}
          colorMode={colorMode}
          onColorModeChange={setColorMode}
          density={density}
          onDensityChange={setDensity}
        />
        <Legend nodes={nodes} colorMode={colorMode} />
      </div>

      {filtering ? (
        <p className="mb-4 inline-flex items-center rounded-full bg-sky-50 px-3 py-1 text-sm font-medium text-sky-700" role="status">
          {matchCount} of {nodes.length} nodes match
        </p>
      ) : null}

      <RacksTabs
        topology={topology}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        colorMode={colorMode}
        density={density}
        search={search}
        filters={filters}
        selectedNode={selectedNode}
        onSelectNode={(node) => setSelectedName(node.name)}
        onCloseDetail={() => setSelectedName(null)}
      />
    </div>
  );
}

const UNPLACED_TAB = 'unplaced';

interface RacksTabsProps {
  topology: TopologyResponse;
  activeTab: SectionTab | null;
  onTabChange: (tab: SectionTab) => void;
  colorMode: ColorMode;
  density: RackDensity;
  search: string;
  filters: RackFilters;
  selectedNode: TopologyNodeDto | null;
  onSelectNode: (node: TopologyNodeDto) => void;
  onCloseDetail: () => void;
}

// Pods + the unplaced group as tabs rather than stacked sections: three
// large sections stacked vertically meant a lot of scrolling to get from
// "GPU pod" to "Unplaced". Tabs show exactly one section at a time, which
// is the standard pattern for a handful of large, mutually-exclusive views.
function RacksTabs({
  topology,
  activeTab,
  onTabChange,
  colorMode,
  density,
  search,
  filters,
  selectedNode,
  onSelectNode,
  onCloseDetail,
}: RacksTabsProps) {
  const tabs: { id: SectionTab; label: string }[] = [
    ...topology.pods.map((pod) => ({ id: pod.name, label: `${pod.name} pod` })),
    ...(topology.unplaced.length > 0 ? [{ id: UNPLACED_TAB, label: 'Unplaced' }] : []),
  ];
  const resolvedTab = activeTab !== null && tabs.some((tab) => tab.id === activeTab) ? activeTab : (tabs[0]?.id ?? null);
  const activePod = topology.pods.find((pod) => pod.name === resolvedTab);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
      {/*
        min-w-0 here is load-bearing, not decoration: as a grid item, this
        div's default automatic minimum width is based on its content's
        size (the full width of every rack side by side), so without it,
        the grid track itself would grow to fit that content and widen the
        whole page instead of letting PodSection's overflow-x-auto row
        scroll internally.
      */}
      <div className="min-w-0">
        {tabs.length > 1 ? (
          <div role="tablist" aria-label="Rack sections" className="mb-3 flex gap-1 border-b border-gray-200">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === resolvedTab}
                onClick={() => onTabChange(tab.id)}
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
        ) : null}
        <div role="tabpanel" className="min-w-0">
          {activePod !== undefined ? (
            <PodSection
              pod={activePod}
              rackHeight={topology.rackHeight}
              density={density}
              colorMode={colorMode}
              search={search}
              filters={filters}
              activeNode={selectedNode}
              onSelect={onSelectNode}
            />
          ) : (
            <NodeGrid
              title="Unplaced nodes"
              description={
                topology.configured ? 'Reported by Slurm but not in the rack layout.' : undefined
              }
              nodes={topology.unplaced}
              colorMode={colorMode}
              search={search}
              filters={filters}
              activeNode={selectedNode}
              onSelect={onSelectNode}
            />
          )}
        </div>
      </div>
      <div className="lg:sticky lg:top-4 lg:self-start">
        <NodeDetailPanel node={selectedNode} onClose={onCloseDetail} />
      </div>
    </div>
  );
}

export { RacksSection };
