import { nodeColorClass, nodeColorLabel, nodeColorStyle } from './rack-color.ts';
import type { ColorMode, LoadScale } from './rack-color.ts';
import { rackNodeStatus } from './rack-status.ts';
import type { TopologyNodeDto } from '../../../shared/api/v1/topology.ts';

interface NodeSlotProps {
  node: TopologyNodeDto;
  colorMode: ColorMode;
  loadScale: LoadScale;
  // False when the node is excluded by the current search/filter.
  matches: boolean;
  // True when a search is active and this node matches it.
  highlighted: boolean;
  // True when this node is the one currently shown in the detail panel.
  active: boolean;
  // Fraction of the box's width this node occupies (1 for a single-node
  // chassis, 1/4 for a 4-node hostlist sharing one box, etc).
  widthFraction: number;
  onSelect: (node: TopologyNodeDto) => void;
}

// One rack bay: a physical node, clickable (or Enter/Space when focused)
// to open the fixed detail panel. Height comes from the parent box; width
// is this node's share of it.
function NodeSlot({ node, colorMode, loadScale, matches, highlighted, active, widthFraction, onSelect }: NodeSlotProps) {
  return (
    <button
      type="button"
      aria-label={`${node.name}: ${nodeColorLabel(node, colorMode, loadScale)}`}
      aria-pressed={active}
      data-status={rackNodeStatus(node)}
      style={{ width: `${widthFraction * 100}%`, ...nodeColorStyle(node, colorMode, loadScale) }}
      onClick={() => onSelect(node)}
      className={`block h-full border border-slate-900/70 outline-none transition-colors hover:z-10 hover:brightness-110 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-900 ${nodeColorClass(node, colorMode)} ${matches ? '' : 'opacity-20 saturate-50'} ${highlighted ? 'ring-2 ring-sky-400 ring-offset-1 ring-offset-slate-900' : ''} ${active ? 'ring-2 ring-offset-1 ring-offset-slate-900 ring-white' : ''}`}
    />
  );
}

export { NodeSlot };
