/** @jest-environment jsdom */
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from './test-query-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RacksSection } from '../../src/client/features/racks/RacksSection';
import type { TopologyNodeDto, TopologyResponse } from '../../src/shared/api/v1/topology';

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function node(overrides: Partial<TopologyNodeDto> = {}): TopologyNodeDto {
  return {
    name: 'nova1-1',
    inSlurm: true,
    state: 'IDLE',
    stateFlags: [],
    availability: 'available',
    reason: null,
    partitions: ['nova'],
    cpus: 64,
    allocCpus: 0,
    cpuLoadBucket: null,
    totalMemoryMiB: 256000,
    allocMemoryMiB: 0,
    gpus: 0,
    allocGpus: 0,
    ...overrides,
  };
}

const TOPOLOGY_BODY: TopologyResponse = {
  configured: true,
  rackHeight: 42,
  pods: [
    {
      name: 'Compute',
      racks: [
        {
          id: 'BD31',
          grid: { row: 'BD', column: 31 },
          boxes: [
            {
              u: 1,
              height: 1,
              label: 'nova1-1',
              nodes: [node({ name: 'nova1-1', state: 'ALLOCATED', allocCpus: 64, cpuLoadBucket: 'high' })],
            },
            {
              u: 3,
              height: 1,
              label: 'nova1-2',
              nodes: [node({ name: 'nova1-2', inSlurm: false, state: null, availability: null })],
            },
          ],
        },
      ],
    },
    {
      name: 'GPU',
      racks: [
        {
          id: 'AD46',
          grid: { row: 'AD', column: 46 },
          boxes: [
            {
              u: 3,
              height: 4,
              label: 'nova2-gpu-1',
              nodes: [node({ name: 'nova2-gpu-1', state: 'MIXED' })],
            },
          ],
        },
      ],
    },
  ],
  unplaced: [node({ name: 'nova1-99' })],
  updatedAt: '2026-10-07T12:00:00.000Z',
};

function setupFetch(overrides: { handler?: () => unknown; fail?: boolean } = {}) {
  const fetchMock = jest.fn(() => {
    if (overrides.fail) {
      return Promise.reject(new TypeError('fetch failed'));
    }
    return Promise.resolve(okJson(overrides.handler ? overrides.handler() : TOPOLOGY_BODY));
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderSection() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RacksSection />
    </QueryClientProvider>,
  );
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('RacksSection', () => {
  test('renders racked nodes on the pod tab and the unplaced group on its own tab', async () => {
    setupFetch();
    renderSection();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('BD31')).toBeTruthy());
    expect(screen.getByLabelText('nova1-1: Allocated')).toBeTruthy();
    expect(screen.getByLabelText('nova1-2: Not in Slurm')).toBeTruthy();
    // Unplaced lives on its own tab, not stacked under the pod.
    expect(screen.queryByText(/Unplaced nodes/)).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Unplaced' }));
    expect(screen.getByText(/Unplaced nodes/)).toBeTruthy();
    expect(screen.getByLabelText('nova1-99: Idle')).toBeTruthy();
    expect(screen.queryByText('BD31')).toBeNull();
  });

  test('legend shows a live count per status', async () => {
    setupFetch();
    renderSection();

    await waitFor(() => expect(screen.getByLabelText('Status legend')).toBeTruthy());
    const legend = screen.getByLabelText('Status legend');
    expect(legend.textContent).toContain('Allocated(1)');
    expect(legend.textContent).toContain('Idle(1)');
    expect(legend.textContent).toContain('Not in Slurm(1)');
  });

  test('clicking a node opens the fixed detail panel with its data', async () => {
    setupFetch();
    renderSection();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByLabelText('nova1-1: Allocated')).toBeTruthy());
    await user.click(screen.getByLabelText('nova1-1: Allocated'));

    await waitFor(() => expect(screen.getByRole('region', { name: 'Details for nova1-1' })).toBeTruthy());
    expect(screen.getByText('64 / 64')).toBeTruthy();
    expect(screen.getByText('high')).toBeTruthy();
  });

  test('not-in-Slurm node shows the retired/typo note instead of live fields', async () => {
    setupFetch();
    renderSection();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByLabelText('nova1-2: Not in Slurm')).toBeTruthy());
    await user.click(screen.getByLabelText('nova1-2: Not in Slurm'));

    await waitFor(() =>
      expect(screen.getByText(/not reported by Slurm/)).toBeTruthy(),
    );
  });

  test('searching dims non-matching nodes rather than removing them', async () => {
    setupFetch();
    renderSection();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByLabelText('nova1-1: Allocated')).toBeTruthy());
    await user.type(screen.getByLabelText('Search node'), 'nova1-1');

    // Still present, not removed from the DOM.
    expect(screen.getByLabelText('nova1-2: Not in Slurm')).toBeTruthy();
    expect(screen.getByLabelText('nova1-2: Not in Slurm').className).toContain('opacity-20');
    expect(screen.getByLabelText('nova1-1: Allocated').className).not.toContain('opacity-20');
    expect(screen.getByText('1 of 4 nodes match')).toBeTruthy();
  });

  test('switching to CPU-load coloring relabels and recolors every node', async () => {
    setupFetch();
    renderSection();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByLabelText('nova1-1: Allocated')).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('Color by'), 'load');

    // Same nodes, relabeled by load instead of status.
    expect(screen.getByLabelText('nova1-1: High load')).toBeTruthy();
    expect(screen.getByLabelText('nova1-2: No load data')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Unplaced' }));
    expect(screen.getByLabelText('nova1-99: No load data')).toBeTruthy();

    // Legend counts are global, independent of which tab is active.
    const legend = screen.getByLabelText('Status legend');
    expect(legend.textContent).toContain('High load(1)');
    expect(legend.textContent).toContain('No load data(3)');
    // The status-specific entries are gone, not just re-counted.
    expect(legend.textContent).not.toContain('Allocated');
  });

  test('pods render as tabs: only one pod is shown at a time', async () => {
    setupFetch();
    renderSection();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('BD31')).toBeTruthy());
    expect(screen.queryByText('AD46')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Compute pod' }).getAttribute('aria-selected')).toBe('true');

    await user.click(screen.getByRole('tab', { name: 'GPU pod' }));
    expect(screen.getByText('AD46')).toBeTruthy();
    expect(screen.queryByText('BD31')).toBeNull();
    expect(screen.getByRole('tab', { name: 'GPU pod' }).getAttribute('aria-selected')).toBe('true');
  });

  test('view toggle switches between compact (default) and full-scale density', async () => {
    setupFetch();
    renderSection();
    const user = userEvent.setup();

    // Compact is the default: the occupied-span label is visible.
    await waitFor(() => expect(screen.getByText('BD31')).toBeTruthy());
    expect(screen.getByText('U1–U3')).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('View'), 'full');
    expect(screen.queryByText('U1–U3')).toBeNull();

    await user.selectOptions(screen.getByLabelText('View'), 'compact');
    expect(screen.getByText('U1–U3')).toBeTruthy();
  });

  test('no layout configured falls back to a flat list of every node', async () => {
    setupFetch({
      handler: () => ({
        configured: false,
        rackHeight: 42,
        pods: [],
        unplaced: [node({ name: 'nova1-1' }), node({ name: 'nova1-2' })],
        updatedAt: '2026-10-07T12:00:00.000Z',
      }),
    });
    renderSection();

    await waitFor(() => expect(screen.getByText(/No rack layout is configured/)).toBeTruthy());
    expect(screen.getByText(/Unplaced nodes/)).toBeTruthy();
    expect(screen.queryByText('BD31')).toBeNull();
  });

  test('fetch failure surfaces a retryable panel', async () => {
    let shouldFail = true;
    global.fetch = jest.fn(() =>
      shouldFail ? Promise.reject(new TypeError('fetch failed')) : Promise.resolve(okJson(TOPOLOGY_BODY)),
    ) as unknown as typeof fetch;
    renderSection();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), { timeout: 8000 });
    shouldFail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('BD31')).toBeTruthy());
  });
});
