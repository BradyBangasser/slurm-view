import { useId } from 'react';
import { NODE_STATUS_CLASSES, NODE_STATUS_LABELS } from './topology.ts';
import type { RackNode } from './topology.ts';

interface NodeSlotProps {
  node: RackNode | null;
  // False when the node is excluded by the current search/filter.
  matches: boolean;
  // True when a search is active and this node matches it.
  highlighted: boolean;
}

function NodeTooltip({ id, node }: { id: string; node: RackNode }) {
  return (
    <div
      id={id}
      role="tooltip"
      className="pointer-events-none absolute top-0 left-full z-20 ml-2 hidden w-max max-w-64 rounded-md border border-black bg-white px-2 py-1 text-xs text-gray-900 shadow-lg group-focus-within:block group-hover:block"
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-2">
        <dt className="text-gray-500">Node id:</dt>
        <dd className="font-medium">{node.name}</dd>
        <dt className="text-gray-500">Status:</dt>
        <dd>
          {NODE_STATUS_LABELS[node.status]}{' '}
          <span className="text-gray-500">({node.slurmState})</span>
        </dd>
        <dt className="text-gray-500">{node.jobs.length > 1 ? 'Jobs:' : 'Job:'}</dt>
        <dd>{node.jobs.length > 0 ? node.jobs.join(', ') : '—'}</dd>
        {node.reason !== null ? (
          <>
            <dt className="text-gray-500">Reason:</dt>
            <dd>{node.reason}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

function NodeSlot({ node, matches, highlighted }: NodeSlotProps) {
  const tooltipId = useId();

  if (node === null) {
    return <div className="h-6 w-[90px] border-b border-black bg-white" aria-hidden="true" />;
  }

  return (
    <div className="group relative focus-within:z-10 hover:z-10">
      <button
        type="button"
        aria-label={`${node.name}: ${NODE_STATUS_LABELS[node.status]}`}
        aria-describedby={tooltipId}
        data-status={node.status}
        className={`block h-6 w-[90px] border-b border-black outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-inset hover:ring-2 hover:ring-white hover:ring-inset ${NODE_STATUS_CLASSES[node.status]} ${matches ? '' : 'opacity-20'} ${highlighted ? 'ring-2 ring-blue-600 ring-inset' : ''}`}
      />
      <NodeTooltip id={tooltipId} node={node} />
    </div>
  );
}

export { NodeSlot };
