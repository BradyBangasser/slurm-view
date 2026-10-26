import { formatMemoryMiB } from '../jobs/formatting.ts';
import { RACK_NODE_STATUS_CLASSES, RACK_NODE_STATUS_LABELS, rackNodeStatus } from './rack-status.ts';
import type { TopologyNodeDto } from '../../../shared/api/v1/topology.ts';

interface NodeDetailPanelProps {
  node: TopologyNodeDto | null;
  onClose: () => void;
}

interface DetailRowProps {
  label: string;
  value: string;
}

function DetailRow({ label, value }: DetailRowProps) {
  return (
    <div className="flex justify-between gap-3 border-b border-gray-100 py-1.5 text-sm last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}

// A fixed side panel, not a hover tooltip: Meeting 4 called out that hover
// tooltips don't work for touch or keyboard-only access (see
// milestone-3d-view.md, "Fixed panel/modal for node detail"). Opened by
// clicking or activating a node bay; stays open across polling refreshes
// since the parent looks the node up by name each render.
function NodeDetailPanel({ node, onClose }: NodeDetailPanelProps) {
  if (node === null) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
        Select a node to see its details.
      </div>
    );
  }

  const status = rackNodeStatus(node);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4" role="region" aria-label={`Details for ${node.name}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-mono text-base font-semibold text-gray-900">{node.name}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close node details"
          className="text-gray-400 hover:text-gray-600"
        >
          &times;
        </button>
      </div>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-600">
        <span className={`inline-block h-2.5 w-2.5 rounded-sm ${RACK_NODE_STATUS_CLASSES[status]}`} aria-hidden="true" />
        {RACK_NODE_STATUS_LABELS[status]}
        {node.state !== null ? <span className="text-gray-400">({node.state}{node.stateFlags.length > 0 ? `+${node.stateFlags.join('+')}` : ''})</span> : null}
      </p>

      {!node.inSlurm ? (
        <p className="mt-3 text-sm text-amber-700">
          This node is in the rack layout but not reported by Slurm. It may be retired or a layout typo.
        </p>
      ) : (
        <div className="mt-3">
          {node.reason !== null ? <DetailRow label="Reason" value={node.reason} /> : null}
          <DetailRow label="Partitions" value={node.partitions.length > 0 ? node.partitions.join(', ') : '—'} />
          <DetailRow
            label="CPUs"
            value={node.cpus === null || node.allocCpus === null ? '—' : `${node.allocCpus} / ${node.cpus}`}
          />
          <DetailRow
            label="CPU load"
            value={node.cpuLoadRatio === null ? '—' : `${Math.round(node.cpuLoadRatio * 100)}%`}
          />
          <DetailRow
            label="Memory"
            value={
              node.totalMemoryMiB === null || node.allocMemoryMiB === null
                ? '—'
                : `${formatMemoryMiB(node.allocMemoryMiB)} / ${formatMemoryMiB(node.totalMemoryMiB)}`
            }
          />
          {node.gpus !== null && node.gpus > 0 ? (
            <DetailRow label="GPUs" value={`${node.allocGpus ?? 0} / ${node.gpus}`} />
          ) : null}
        </div>
      )}
    </div>
  );
}

export { NodeDetailPanel };
