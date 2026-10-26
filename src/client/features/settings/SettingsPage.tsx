import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { fetchTopology } from '../../api/topology.ts';
import { fetchUiSettings, updateUiSettings } from '../../api/ui-settings.ts';
import { topologyKeys, uiSettingsKeys } from '../../api/query-keys.ts';
import { ErrorPanel } from '../../components/ErrorPanel.tsx';
import { Navbar } from '../../components/Navbar.tsx';

// Rack reordering works off the ids currently in the layout; ids the user
// previously saved that no longer exist (retired/renamed racks) are just
// dropped silently when this list loads — same "stale ids are fine"
// tolerance as the server schema.
function moveRackId(order: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction;
  if (target < 0 || target >= order.length) {
    return order;
  }
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function SettingsPage() {
  const queryClient = useQueryClient();

  const uiSettingsQuery = useQuery({
    queryKey: uiSettingsKeys.detail,
    queryFn: ({ signal }) => fetchUiSettings({ signal }),
    staleTime: Infinity,
  });
  const topologyQuery = useQuery({
    queryKey: topologyKeys.detail,
    queryFn: ({ signal }) => fetchTopology({ signal }),
    staleTime: 15_000,
  });

  const [maxRacksPerRow, setMaxRacksPerRow] = useState<number>(6);
  const [rackOrder, setRackOrder] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed local edit state once the current settings arrive; a later
  // background refetch (e.g. from another tab's save) must not clobber
  // what the user is actively editing here.
  useEffect(() => {
    if (uiSettingsQuery.data && saveState === 'idle') {
      setMaxRacksPerRow(uiSettingsQuery.data.topology.maxRacksPerRow);
      setRackOrder(uiSettingsQuery.data.topology.rackOrder);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiSettingsQuery.data]);

  const knownRackIds = topologyQuery.data?.pods.flatMap((pod) => pod.racks.map((rack) => rack.id)) ?? [];
  // Racks the user hasn't ordered yet, appended after their saved order so
  // every known rack is represented once the list renders.
  const orderedRackIds = [
    ...rackOrder.filter((id) => knownRackIds.includes(id)),
    ...knownRackIds.filter((id) => !rackOrder.includes(id)),
  ];

  async function handleSave() {
    setSaveState('saving');
    setSaveError(null);
    try {
      const response = await updateUiSettings({
        topology: { maxRacksPerRow, rackOrder: orderedRackIds },
      });
      queryClient.setQueryData(uiSettingsKeys.detail, response);
      setRackOrder(response.topology.rackOrder);
      setMaxRacksPerRow(response.topology.maxRacksPerRow);
      setSaveState('saved');
    } catch (error) {
      setSaveState('error');
      setSaveError(errorMessage(error));
    }
  }

  function handleReset() {
    if (!uiSettingsQuery.data) return;
    setMaxRacksPerRow(uiSettingsQuery.data.topology.maxRacksPerRow);
    setRackOrder(uiSettingsQuery.data.topology.rackOrder);
    setSaveState('idle');
    setSaveError(null);
  }

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-900">
      <Navbar />
      <main className="mx-auto max-w-[800px] px-5 py-8">
        <h1 className="text-2xl font-semibold">Display settings</h1>
        <p className="mt-1 text-sm text-gray-600">
          These are your own preferences, saved to your personal config override. They never change what other
          viewers see, and they can't touch the site's rack layout.
        </p>

        {uiSettingsQuery.isPending ? (
          <div className="mt-8 h-48 w-full animate-pulse rounded-lg bg-gray-200" aria-busy="true" />
        ) : uiSettingsQuery.isError ? (
          <div className="mt-8">
            <ErrorPanel message={errorMessage(uiSettingsQuery.error)} onRetry={() => void uiSettingsQuery.refetch()} />
          </div>
        ) : (
          <div className="mt-8 space-y-8">
            <section className="rounded-lg border border-gray-200 bg-white p-5">
              <h2 className="text-lg font-medium">Rack row width</h2>
              <p className="mt-1 text-sm text-gray-600">
                How many racks to show side by side before wrapping to a new row.
              </p>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={maxRacksPerRow}
                  onChange={(event) => setMaxRacksPerRow(Number(event.target.value))}
                  className="w-20 rounded border border-gray-300 px-2 py-1"
                />
                racks per row
              </label>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-5">
              <h2 className="text-lg font-medium">Rack order</h2>
              <p className="mt-1 text-sm text-gray-600">
                Reorder the racks as they appear in the Node Status section.
              </p>
              {topologyQuery.isPending ? (
                <div className="mt-3 h-24 w-full animate-pulse rounded bg-gray-100" aria-busy="true" />
              ) : topologyQuery.isError ? (
                <p className="mt-3 text-sm text-red-700">Couldn't load the current rack layout to reorder.</p>
              ) : orderedRackIds.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">No racks configured on this site yet.</p>
              ) : (
                <ol className="mt-3 divide-y divide-gray-100 rounded border border-gray-200">
                  {orderedRackIds.map((rackId, index) => (
                    <li key={rackId} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="font-mono">{rackId}</span>
                      <span className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setRackOrder(moveRackId(orderedRackIds, index, -1))}
                          disabled={index === 0}
                          aria-label={`Move ${rackId} up`}
                          className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => setRackOrder(moveRackId(orderedRackIds, index, 1))}
                          disabled={index === orderedRackIds.length - 1}
                          aria-label={`Move ${rackId} down`}
                          className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40"
                        >
                          ↓
                        </button>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saveState === 'saving'}
                className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
              >
                {saveState === 'saving' ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Reset
              </button>
              {saveState === 'saved' ? <span className="text-sm text-green-700">Saved.</span> : null}
              {saveState === 'error' ? <span className="text-sm text-red-700">{saveError}</span> : null}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export { SettingsPage };
