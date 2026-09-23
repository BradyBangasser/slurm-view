import { useMemo, useState } from 'react';
import { buildDummyTopology } from './dummy-topology.ts';
import { NodeSlot } from './NodeSlot.tsx';
import { RackColumn } from './RackColumn.tsx';
import { NODE_STATUSES, NODE_STATUS_CLASSES, NODE_STATUS_LABELS, nodeMatches } from './topology.ts';
import type { NodeStatusFilter } from './topology.ts';

function StatusLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-4 text-sm text-gray-700">
      {NODE_STATUSES.map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <span className={`inline-block h-3 w-5 border border-black ${NODE_STATUS_CLASSES[status]}`} />
          {NODE_STATUS_LABELS[status]}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 border border-black bg-white" />
        Empty slot
      </li>
    </ul>
  );
}

// Physical rack view of cluster nodes. UI only for now: renders dummy
// topology until the /api/v1/topology route (Milestone 3) exists.
function NodeStatusSection() {
  const topology = useMemo(() => buildDummyTopology(), []);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<NodeStatusFilter>('all');

  const allNodes = [
    ...topology.racks.flatMap((rack) => rack.slots.flatMap((slot) => (slot.node === null ? [] : [slot.node]))),
    ...topology.unplaced,
  ];
  const matchCount = allNodes.filter((node) => nodeMatches(node, search, filter)).length;
  const filtering = search.trim() !== '' || filter !== 'all';

  return (
    <div id="node-status" className="mb-12 scroll-mt-24">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold">Node Status</h2>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
          Preview — sample data
        </span>
      </div>

      <div className="rounded-lg border bg-white shadow">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b p-4">
          <div className="flex items-center space-x-2">
            <label htmlFor="node-search" className="text-sm">
              Search Node:
            </label>
            <input
              id="node-search"
              type="search"
              className="w-[180px] rounded border p-2 text-sm"
              placeholder="e.g. nova012"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="flex items-center space-x-2">
            <label htmlFor="node-filter" className="text-sm">
              Filter By:
            </label>
            <select
              id="node-filter"
              className="w-[180px] rounded border p-2 text-sm"
              value={filter}
              onChange={(event) => setFilter(event.target.value as NodeStatusFilter)}
            >
              <option value="all">All statuses</option>
              {NODE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {NODE_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <StatusLegend />
          {filtering ? (
            <p className="text-sm text-gray-600" role="status">
              {matchCount} of {allNodes.length} nodes match
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-x-12 gap-y-6 p-6">
          {topology.racks.map((rack) => (
            <RackColumn key={rack.id} rack={rack} search={search} filter={filter} />
          ))}
        </div>

        {topology.unplaced.length > 0 ? (
          <div className="border-t px-6 py-4">
            <h3 className="mb-2 text-sm font-medium text-gray-700">Unplaced nodes</h3>
            <div className="flex flex-wrap gap-2" role="list" aria-label="Unplaced nodes">
              {topology.unplaced.map((node) => (
                <div key={node.name} role="listitem" className="border-4 border-neutral-900 rounded">
                  <NodeSlot
                    node={node}
                    matches={nodeMatches(node, search, filter)}
                    highlighted={search.trim() !== '' && nodeMatches(node, search, filter)}
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
