import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '../../api/client.ts';
import { fetchTopology } from '../../api/topology.ts';
import { fetchUiSettings } from '../../api/ui-settings.ts';
import { topologyKeys, uiSettingsKeys } from '../../api/query-keys.ts';
import { ErrorPanel } from '../../components/ErrorPanel.tsx';
import { RefreshWarning } from '../../components/RefreshWarning.tsx';
import { PodView } from './PodView.tsx';

function RacksSkeleton() {
  return (
    <div className="flex items-center justify-center p-8" aria-busy="true" aria-label="Loading rack layout">
      <div className="h-48 w-full max-w-3xl animate-pulse rounded-lg bg-gray-200" />
    </div>
  );
}

// Data-fetching shell: holds the topology and ui-settings queries and the
// page-level header (title, last-updated, error/warning banners). All of
// the view's own interaction state (search, filters, color mode, density,
// tabs, combined view, fullscreen) lives in PodView.tsx instead — this
// component doesn't need to know about any of it.
function RacksSection() {
  // Same cadence as the NodesCache TTL it reads: see CLAUDE.md's cache
  // table. Explicitly live, like stats and jobs — no focus/reconnect
  // refetch (project defaults), but a fresh poll every 15s and on remount.
  const topologyQuery = useQuery({
    queryKey: topologyKeys.detail,
    queryFn: ({ signal }) => fetchTopology({ signal }),
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchOnMount: true,
  });

  // Per-user row-width and rack-order preferences, set on the Settings page
  // (client/features/settings/SettingsPage.tsx). Same query key and query
  // client as that page and the Navbar, so a save there is reflected here
  // immediately via the shared React Query cache — no refetch needed.
  const uiSettingsQuery = useQuery({
    queryKey: uiSettingsKeys.detail,
    queryFn: ({ signal }) => fetchUiSettings({ signal }),
    staleTime: Infinity,
  });
  const maxRacksPerRow = uiSettingsQuery.data?.topology?.maxRacksPerRow;
  const rackOrder = uiSettingsQuery.data?.topology?.rackOrder;

  if (topologyQuery.data === undefined) {
    if (topologyQuery.isPending) {
      return (
        <div id="node-status" className="mb-12 scroll-mt-24">
          <h2 className="mb-6 text-2xl font-semibold">Node Status</h2>
          <RacksSkeleton />
        </div>
      );
    }
    return (
      <div id="node-status" className="mb-12 scroll-mt-24">
        <h2 className="mb-6 text-2xl font-semibold">Node Status</h2>
        <ErrorPanel message={errorMessage(topologyQuery.error)} onRetry={() => void topologyQuery.refetch()} />
      </div>
    );
  }

  const topology = topologyQuery.data;

  return (
    <div id="node-status" className="mb-12 scroll-mt-24">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold">Node Status</h2>
        <div className="flex items-center gap-3 text-sm text-gray-600">
          {topologyQuery.isFetching ? <span aria-live="polite">Refreshing…</span> : null}
          <span>Last updated: {new Date(topology.updatedAt).toLocaleTimeString()}</span>
        </div>
      </div>

      {topologyQuery.isError ? (
        <div className="mb-4">
          <RefreshWarning
            message="Showing the previous node layout because the latest refresh failed."
            onRetry={() => void topologyQuery.refetch()}
          />
        </div>
      ) : null}

      {!topology.configured ? (
        <p className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800" role="status">
          No rack layout is configured for this site, so nodes are shown as a flat list
          rather than their physical positions.
        </p>
      ) : null}

      <PodView topology={topology} maxRacksPerRow={maxRacksPerRow} rackOrder={rackOrder} />
    </div>
  );
}

export { RacksSection };
