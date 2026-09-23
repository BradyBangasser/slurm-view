import { NodeSlot } from './NodeSlot.tsx';
import { nodeMatches } from './topology.ts';
import type { NodeStatusFilter, Rack } from './topology.ts';

interface RackColumnProps {
  rack: Rack;
  search: string;
  filter: NodeStatusFilter;
}

// One physical rack: slots stacked top to bottom in slot order.
function RackColumn({ rack, search, filter }: RackColumnProps) {
  const searching = search.trim() !== '';
  return (
    <figure className="flex flex-col items-center gap-1">
      <figcaption className="text-sm font-medium text-gray-700">{rack.id}</figcaption>
      <div className="rounded border-4 border-neutral-900 bg-neutral-900" role="list" aria-label={`Rack ${rack.id}`}>
        {rack.slots.map(({ slot, node }) => (
          <div key={slot} role="listitem">
            <NodeSlot
              node={node}
              matches={node !== null && nodeMatches(node, search, filter)}
              highlighted={searching && node !== null && nodeMatches(node, search, filter)}
            />
          </div>
        ))}
      </div>
    </figure>
  );
}

export { RackColumn };
