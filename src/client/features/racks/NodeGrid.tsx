import { nodeColorClass, nodeColorLabel } from './rack-color.ts';
import type { ColorMode } from './rack-color.ts';
import { nodeMatches } from './rack-filters.ts';
import type { RackFilters } from './rack-filters.ts';
import type { TopologyNodeDto } from '../../../shared/api/v1/topology.ts';

interface NodeGridProps {
  title: string;
  description?: string;
  nodes: TopologyNodeDto[];
  colorMode: ColorMode;
  search: string;
  filters: RackFilters;
  activeNode: TopologyNodeDto | null;
  onSelect: (node: TopologyNodeDto) => void;
}

// A dense grid for nodes that aren't drawn as a rack elevation: the
// "Unplaced" group (in Slurm, not in the layout) and, when the site has no
// `topology` config at all, every node (see milestone-3d-view.md FE-3's
// "no layout configured" state).
function NodeGrid({ title, description, nodes, colorMode, search, filters, activeNode, onSelect }: NodeGridProps) {
  if (nodes.length === 0) {
    return null;
  }
  const searching = search.trim() !== '';
  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold text-gray-700">
        {title} <span className="font-normal text-gray-400">({nodes.length})</span>
      </h3>
      {description !== undefined ? <p className="mt-1 text-sm text-gray-500">{description}</p> : null}
      <div className="mt-2 flex flex-wrap gap-1" role="list" aria-label={title}>
        {nodes.map((node) => {
          const matches = nodeMatches(node, search, filters);
          const active = node.name === activeNode?.name;
          return (
            <button
              key={node.name}
              type="button"
              role="listitem"
              aria-label={`${node.name}: ${nodeColorLabel(node, colorMode)}`}
              aria-pressed={active}
              onClick={() => onSelect(node)}
              className={`h-8 w-28 truncate rounded-sm border border-black/10 px-1.5 text-left text-xs font-mono text-slate-900 outline-none transition-colors hover:brightness-95 focus-visible:ring-2 focus-visible:ring-sky-400 ${nodeColorClass(node, colorMode)} ${matches ? '' : 'opacity-20 saturate-50'} ${searching && matches ? 'ring-2 ring-sky-400' : ''} ${active ? 'ring-2 ring-slate-900' : ''}`}
            >
              {node.name}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export { NodeGrid };
