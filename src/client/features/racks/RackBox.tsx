import { NodeSlot } from './NodeSlot.tsx';
import type { ColorMode } from './rack-color.ts';
import { nodeMatches } from './rack-filters.ts';
import type { RackFilters } from './rack-filters.ts';
import type { TopologyBoxDto, TopologyNodeDto } from '../../../shared/api/v1/topology.ts';

interface RackBoxProps {
  box: TopologyBoxDto;
  colorMode: ColorMode;
  search: string;
  filters: RackFilters;
  activeNode: TopologyNodeDto | null;
  onSelect: (node: TopologyNodeDto) => void;
}

// One physical box (one line in racks.yaml): a single node, or several
// sharing the box when the layout entry is a hostlist (e.g. a 4-node
// chassis). Each node gets an equal share of the box's width.
function RackBox({ box, colorMode, search, filters, activeNode, onSelect }: RackBoxProps) {
  const searching = search.trim() !== '';
  return (
    <div className="flex h-full w-full">
      {box.nodes.map((node) => (
        <NodeSlot
          key={node.name}
          node={node}
          colorMode={colorMode}
          widthFraction={1 / box.nodes.length}
          matches={nodeMatches(node, search, filters)}
          highlighted={searching && nodeMatches(node, search, filters)}
          // Compared by name, not reference: a poll replaces the whole
          // response object, so the previously selected node is a new
          // object on every refresh even when nothing about it changed.
          active={node.name === activeNode?.name}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export { RackBox };
