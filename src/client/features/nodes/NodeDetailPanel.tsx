import { NODE_STATUS_CLASSES, NODE_STATUS_LABELS } from './topology.ts';
import type { RackNode } from './topology.ts';

interface NodeDetailPanelProps {
  node: RackNode | null;
  // True once the user has clicked a node, so the panel stays open on
  // mouse-out and shows a close control instead of just previewing on hover.
  pinned: boolean;
  onClose: () => void;
}

// Detail pane docked to the right of the rack view. Hovering a node shows a
// live preview here; clicking pins it open until closed, replacing the old
// tooltip-next-to-the-node behavior.
function NodeDetailPanel({ node, pinned, onClose }: NodeDetailPanelProps) {
  if (node === null) {
    return (
      <aside
        aria-label="Node details"
        className="hidden w-72 shrink-0 self-start rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-400 lg:block"
      >
        <p>Hover or click a node to see its details here.</p>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Node details"
      role={pinned ? 'dialog' : undefined}
      aria-live={pinned ? undefined : 'polite'}
      className="w-72 shrink-0 self-start overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-md"
    >
      <div className="flex items-start justify-between gap-2 border-b border-slate-700 bg-slate-800 px-4 py-3 text-white">
        <div>
          <h3 className="font-mono text-base font-semibold">{node.name}</h3>
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-300">
            <span className={`inline-block h-2 w-2 rounded-full ${NODE_STATUS_CLASSES[node.status]}`} />
            {NODE_STATUS_LABELS[node.status]}
            <span className="text-slate-400">({node.slurmState})</span>
          </span>
        </div>
        {pinned ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close node details"
            className="rounded-full px-1.5 py-0.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            ×
          </button>
        ) : (
          <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-200">Preview</span>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 p-4">
        <dt className="text-slate-400">Partitions:</dt>
        <dd className="text-slate-900">{node.partitions.join(', ')}</dd>
        <dt className="text-slate-400">{node.jobs.length > 1 ? 'Jobs:' : 'Job:'}</dt>
        <dd className="text-slate-900">{node.jobs.length > 0 ? node.jobs.join(', ') : '—'}</dd>
        <dt className="text-slate-400">{node.users.length > 1 ? 'Users:' : 'User:'}</dt>
        <dd className="text-slate-900">{node.users.length > 0 ? node.users.join(', ') : '—'}</dd>
        <dt className="text-slate-400">{node.accounts.length > 1 ? 'Accounts:' : 'Account:'}</dt>
        <dd className="text-slate-900">{node.accounts.length > 0 ? node.accounts.join(', ') : '—'}</dd>
        {node.reason !== null ? (
          <>
            <dt className="text-slate-400">Reason:</dt>
            <dd className="text-slate-900">{node.reason}</dd>
          </>
        ) : null}
      </dl>
    </aside>
  );
}

export { NodeDetailPanel };
