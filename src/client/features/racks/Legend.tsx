import type { ColorMode } from './rack-color.ts';
import { LOAD_CLASSES, LOAD_LABELS, LOAD_LEGEND_KEYS, loadLegendKey } from './rack-color.ts';
import { RACK_NODE_STATUSES, RACK_NODE_STATUS_CLASSES, RACK_NODE_STATUS_LABELS, rackNodeStatus } from './rack-status.ts';
import type { RackNodeStatus } from './rack-status.ts';
import type { LoadLegendKey } from './rack-color.ts';
import type { TopologyNodeDto } from '../../../shared/api/v1/topology.ts';

// Status legend for the rack elevation, with a live count per entry (from
// the node-visualization prototype's StatusLegend) so the legend doubles as
// an at-a-glance summary. Switches to the load scale when colorMode is
// "load", matching whatever the boxes are actually colored by. A fixed
// order so it reads the same every render, matching the 2-D/3-D palette
// note in milestone-3d-view.md.
function Legend({ nodes, colorMode }: { nodes: TopologyNodeDto[]; colorMode: ColorMode }) {
  if (colorMode === 'load') {
    const counts = new Map<LoadLegendKey, number>();
    for (const node of nodes) {
      const key = loadLegendKey(node);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return (
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600" aria-label="Status legend">
        {LOAD_LEGEND_KEYS.map((key) => (
          <li key={key} className="flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 rounded-sm border border-black/10 ${LOAD_CLASSES[key]}`} aria-hidden="true" />
            {LOAD_LABELS[key]}
            <span className="tabular-nums text-gray-400">({counts.get(key) ?? 0})</span>
          </li>
        ))}
      </ul>
    );
  }

  const counts = new Map<RackNodeStatus, number>();
  for (const node of nodes) {
    const status = rackNodeStatus(node);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600" aria-label="Status legend">
      {RACK_NODE_STATUSES.map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <span
            className={`inline-block h-3 w-3 rounded-sm border border-black/10 ${RACK_NODE_STATUS_CLASSES[status]}`}
            aria-hidden="true"
          />
          {RACK_NODE_STATUS_LABELS[status]}
          <span className="tabular-nums text-gray-400">({counts.get(status) ?? 0})</span>
        </li>
      ))}
    </ul>
  );
}

export { Legend };
