import { useMemo, useState } from 'react';
import { buildDummyTopology } from './dummy-topology.ts';
import { NodeDetailPanel } from './NodeDetailPanel.tsx';
import { NodeSlot } from './NodeSlot.tsx';
import { RackColumn } from './RackColumn.tsx';
import {
  accountsIn,
  allNodes,
  DEFAULT_FILTERS,
  NODE_STATUSES,
  NODE_STATUS_CLASSES,
  NODE_STATUS_LABELS,
  nodeMatches,
} from './topology.ts';
import type { NodeFilters, NodeStatus, RackNode } from './topology.ts';

function StatusLegend({ nodes }: { nodes: RackNode[] }) {
  const counts = new Map<NodeStatus, number>();
  for (const node of nodes) {
    counts.set(node.status, (counts.get(node.status) ?? 0) + 1);
  }

  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
      {NODE_STATUSES.map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-full shadow-sm ${NODE_STATUS_CLASSES[status]}`} />
          {NODE_STATUS_LABELS[status]}
          <span className="tabular-nums text-slate-400">({counts.get(status) ?? 0})</span>
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-slate-400" />
        Empty slot
      </li>
    </ul>
  );
}

// Physical rack view of cluster nodes. UI only for now: renders dummy
// topology until the /api/v1/topology route (Milestone 3) exists.
function NodeStatusSection() {
  const topology = useMemo(() => buildDummyTopology(), []);
  const accountOptions = useMemo(() => accountsIn(topology), [topology]);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<NodeFilters>(DEFAULT_FILTERS);
  // Hovering a node previews it in the side panel; clicking pins it open.
  const [hoveredNode, setHoveredNode] = useState<RackNode | null>(null);
  const [pinnedNode, setPinnedNode] = useState<RackNode | null>(null);

  const nodes = allNodes(topology);
  const matchCount = nodes.filter((node) => nodeMatches(node, search, filters)).length;
  const filtering = search.trim() !== '' || filters.status !== 'all' || filters.account !== 'all' || filters.mineOnly;

  const activeNode = pinnedNode ?? hoveredNode;

  function handleSelect(node: RackNode) {
    setPinnedNode((current) => (current?.name === node.name ? null : node));
  }

  return (
    <div id="node-status" className="mb-12 scroll-mt-24">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold">Node Status</h2>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
          Preview — sample data
        </span>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-slate-50/60 p-4">
          <div className="flex items-center gap-2">
            <label htmlFor="node-search" className="text-sm font-medium text-slate-600">
              Search Node:
            </label>
            <input
              id="node-search"
              type="search"
              className="w-[180px] rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              placeholder="e.g. nova012"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="node-filter" className="text-sm font-medium text-slate-600">
              Filter By:
            </label>
            <select
              id="node-filter"
              className="w-[160px] rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              value={filters.status}
              onChange={(event) => setFilters((f) => ({ ...f, status: event.target.value as NodeFilters['status'] }))}
            >
              <option value="all">All statuses</option>
              {NODE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {NODE_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="node-account-filter" className="text-sm font-medium text-slate-600">
              Account:
            </label>
            <select
              id="node-account-filter"
              className="w-[160px] rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              value={filters.account}
              onChange={(event) => setFilters((f) => ({ ...f, account: event.target.value }))}
            >
              <option value="all">All accounts</option>
              {accountOptions.map((account) => (
                <option key={account} value={account}>
                  {account}
                </option>
              ))}
            </select>
          </div>
          <label
            htmlFor="node-mine-only"
            className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm"
          >
            <input
              id="node-mine-only"
              type="checkbox"
              checked={filters.mineOnly}
              onChange={(event) => setFilters((f) => ({ ...f, mineOnly: event.target.checked }))}
              className="h-3.5 w-3.5 accent-sky-600"
            />
            <span>My nodes</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
          <StatusLegend nodes={nodes} />
          {filtering ? (
            <p className="rounded-full bg-sky-50 px-3 py-1 text-sm font-medium text-sky-700" role="status">
              {matchCount} of {nodes.length} nodes match
            </p>
          ) : null}
        </div>

        <div className="flex gap-6 p-5">
          <div className="flex flex-1 flex-wrap gap-x-10 gap-y-6 rounded-lg bg-slate-100/70 p-5">
            {topology.racks.map((rack) => (
              <RackColumn
                key={rack.id}
                rack={rack}
                search={search}
                filters={filters}
                activeNode={activeNode}
                onHover={setHoveredNode}
                onSelect={handleSelect}
              />
            ))}
          </div>
          <NodeDetailPanel node={activeNode} pinned={pinnedNode !== null} onClose={() => setPinnedNode(null)} />
        </div>

        {topology.unplaced.length > 0 ? (
          <div className="border-t border-slate-100 px-5 py-4">
            <h3 className="mb-2 text-sm font-medium text-slate-500">Unplaced nodes</h3>
            <div
              className="flex flex-wrap gap-1 rounded-md border border-slate-900 bg-slate-800 p-1"
              role="list"
              aria-label="Unplaced nodes"
            >
              {topology.unplaced.map((node) => (
                <div key={node.name} role="listitem" className="h-6 w-[92px]">
                  <NodeSlot
                    node={node}
                    widthFraction={1}
                    matches={nodeMatches(node, search, filters)}
                    highlighted={search.trim() !== '' && nodeMatches(node, search, filters)}
                    active={node === activeNode}
                    onHover={setHoveredNode}
                    onSelect={handleSelect}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { NodeStatusSection };
