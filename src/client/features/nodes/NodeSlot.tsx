import { NODE_STATUS_BAY_CLASSES, NODE_STATUS_LABELS } from './topology.ts';
import type { RackNode } from './topology.ts';

interface NodeSlotProps {
  node: RackNode | null;
  // False when the node is excluded by the current search/filter.
  matches: boolean;
  // True when a search is active and this node matches it.
  highlighted: boolean;
  // True when this node is the one currently shown in the detail panel.
  active: boolean;
  // Fraction of the item's width this bay occupies (1 for a single-node
  // chassis, 1/4 for a 2U Quad sled, etc).
  widthFraction: number;
  onHover: (node: RackNode | null) => void;
  onSelect: (node: RackNode) => void;
}

// One rack bay: either a physical node (clickable/hoverable to open the
// detail panel) or an empty bay. Height comes from the parent RackItem;
// width is this bay's share of the item.
function NodeSlot({ node, matches, highlighted, active, widthFraction, onHover, onSelect }: NodeSlotProps) {
  const style = { width: `${widthFraction * 100}%` };

  if (node === null) {
    return (
      <div
        className="h-full border border-dashed border-slate-500/60 bg-slate-800"
        style={style}
        aria-hidden="true"
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`${node.name}: ${NODE_STATUS_LABELS[node.status]}`}
      aria-pressed={active}
      data-status={node.status}
      style={style}
      onMouseEnter={() => onHover(node)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(node)}
      onBlur={() => onHover(null)}
      onClick={() => onSelect(node)}
      className={`block h-full border border-slate-900/70 outline-none transition-colors hover:z-10 hover:brightness-110 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-900 ${NODE_STATUS_BAY_CLASSES[node.status]} ${matches ? '' : 'opacity-20 saturate-50'} ${highlighted ? 'ring-2 ring-sky-400 ring-offset-1 ring-offset-slate-900' : ''} ${active ? 'ring-2 ring-offset-1 ring-offset-slate-900 ring-white' : ''}`}
    />
  );
}

export { NodeSlot };
