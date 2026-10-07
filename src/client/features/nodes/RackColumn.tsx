import { NodeSlot } from './NodeSlot.tsx';
import { nodeMatches } from './topology.ts';
import type { NodeFilters, Rack, RackNode } from './topology.ts';

// Height of one rack unit in the elevation. Multi-U items are a multiple of
// this (a 4U item is 4x as tall as a 1U item).
const UNIT_HEIGHT_PX = 26;

interface RackColumnProps {
  rack: Rack;
  search: string;
  filters: NodeFilters;
  activeNode: RackNode | null;
  onHover: (node: RackNode | null) => void;
  onSelect: (node: RackNode) => void;
}

// One physical rack: items stacked top to bottom, each sized by its height
// in rack units and split into one or more bays by width. Styled as a dark
// enclosure with its own rail posts, so it reads as hardware rather than a
// plain list.
function RackColumn({ rack, search, filters, activeNode, onHover, onSelect }: RackColumnProps) {
  const searching = search.trim() !== '';
  return (
    <figure className="flex flex-col items-center gap-0">
      <figcaption className="mb-1.5 rounded-full bg-slate-800 px-3 py-0.5 text-xs font-semibold tracking-wide text-slate-100 shadow">
        {rack.id}
      </figcaption>
      <div
        className="flex gap-1 rounded-md border border-slate-900 bg-slate-800 p-1"
        role="list"
        aria-label={`Rack ${rack.id}`}
      >
        {/* Mounting rails flanking the bays, like a real rack's rail posts. */}
        <div className="w-1 shrink-0 bg-slate-950" aria-hidden="true" />
        <div className="flex flex-col">
          {rack.items.map((item) => (
            <div
              key={item.id}
              role="listitem"
              className="flex w-[92px]"
              style={{ height: item.heightU * UNIT_HEIGHT_PX }}
            >
              {item.bays.map((node, bayIndex) => (
                <NodeSlot
                  key={node?.name ?? `${item.id}-${bayIndex}`}
                  node={node}
                  widthFraction={1 / item.bays.length}
                  matches={node !== null && nodeMatches(node, search, filters)}
                  highlighted={searching && node !== null && nodeMatches(node, search, filters)}
                  active={node !== null && node === activeNode}
                  onHover={onHover}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="w-1 shrink-0 bg-slate-950" aria-hidden="true" />
      </div>
    </figure>
  );
}

export { RackColumn };
