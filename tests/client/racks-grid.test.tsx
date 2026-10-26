/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DOTTED_GRID_STYLE, RacksGrid } from '../../src/client/features/racks/RacksGrid';
import { DEFAULT_RACK_FILTERS } from '../../src/client/features/racks/rack-filters';
import type { TopologyRackDto } from '../../src/shared/api/v1/topology';

function rack(id: string): TopologyRackDto {
  return { id, grid: null, boxes: [] };
}

function renderGrid(props: Partial<Parameters<typeof RacksGrid>[0]> = {}) {
  render(
    <RacksGrid
      title="Test pod (2 racks)"
      racks={[{ rack: rack('A01') }, { rack: rack('A02') }]}
      rackHeight={42}
      density="compact"
      onDensityChange={() => {}}
      colorMode="status"
      onColorModeChange={() => {}}
      search=""
      onSearchChange={() => {}}
      filters={DEFAULT_RACK_FILTERS}
      onFiltersChange={() => {}}
      partitions={[]}
      combinedView={false}
      onCombinedViewChange={() => {}}
      combinedViewAvailable={false}
      legendNodes={[]}
      activeNode={null}
      onSelect={() => {}}
      onCloseDetail={() => {}}
      {...props}
    />,
  );
}

// Regression tests for two real bugs hit building the row-width feature,
// both from trying to force a fixed-count row with flex-wrap + a
// hand-computed pixel width (see milestone-3d-view.md's 2026-10-26 entries
// for the full story):
//   1. Setting only `maxWidth` let the (block-level) flex container fill
//      its normally-much-wider parent, so it never actually ran out of
//      room — flex-wrap had the class but nothing to do.
//   2. Even after forcing an explicit `width`, the pixel estimate
//      (maxRacksPerRow * RACK_WIDTH_PX) missed real per-rack chrome
//      (RackColumn.tsx's rail posts, border, padding), so the computed
//      width fit fewer real racks than configured and wrapped too early.
// The fix replaces pixel math entirely with CSS Grid
// (`repeat(N, max-content)`), which sizes columns from each rack's real
// rendered width and needs no width estimate to keep in sync with
// RackColumn's markup.
describe('RacksGrid row-wrap behavior', () => {
  test('is a flex row by default (the single-pod horizontal-scroll strip), not a grid', () => {
    renderGrid();
    const container = screen.getByLabelText('Rack A01').closest('.rack-scroll') as HTMLElement;
    expect(container.className).toContain('flex');
    expect(container.className).not.toContain('flex-wrap');
    expect(container.className).not.toContain('grid');
  });

  test('switches to a grid with exactly maxRacksPerRow columns, not an estimated flex width', () => {
    renderGrid({ maxRacksPerRow: 7 });
    const container = screen.getByLabelText('Rack A01').closest('.rack-scroll') as HTMLElement;
    expect(container.className).toContain('grid');
    expect(container.className).not.toContain('flex-wrap');
    expect(container.style.gridTemplateColumns).toBe('repeat(7, max-content)');
    expect(container.style.width).toBe('');
    expect(container.style.maxWidth).toBe('');
  });

  test('the combined view (wrap=true, no maxRacksPerRow) stays flex-wrap, unbounded by a column count', () => {
    renderGrid({ wrap: true });
    const container = screen.getByLabelText('Rack A01').closest('.rack-scroll') as HTMLElement;
    expect(container.className).toContain('flex-wrap');
    expect(container.className).not.toContain('grid');
  });

  test('maxRacksPerRow takes the grid layout even when wrap is also true', () => {
    renderGrid({ wrap: true, maxRacksPerRow: 3 });
    const container = screen.getByLabelText('Rack A01').closest('.rack-scroll') as HTMLElement;
    expect(container.className).toContain('grid');
    expect(container.style.gridTemplateColumns).toBe('repeat(3, max-content)');
  });
});

describe('RacksGrid dotted background', () => {
  // The dots are a CSS radial-gradient background-image. jsdom's style
  // engine (cssstyle) doesn't echo gradient values back through
  // `.style.backgroundImage` the way a real browser does — that's an
  // environment limitation, not something to assert on — so this checks
  // the exported style object directly (what actually gets passed as
  // `style=`) and, on the DOM, the one sub-property jsdom does preserve
  // (`backgroundSize`) as a smoke check that *some* style was applied.
  test('DOTTED_GRID_STYLE is a radial-gradient dot pattern', () => {
    expect(DOTTED_GRID_STYLE.backgroundImage).toContain('radial-gradient');
    expect(DOTTED_GRID_STYLE.backgroundSize).toBe('20px 20px');
  });

  test('the rack-elevation content area has the background applied', () => {
    renderGrid();
    const container = screen.getByLabelText('Rack A01').closest('.rack-scroll') as HTMLElement;
    expect(container.style.backgroundSize).toBe('20px 20px');
  });

  test('the flat-node-grid content area (no racks) also has the background applied', () => {
    renderGrid({
      racks: [],
      flatNodes: [
        {
          name: 'nova1-99',
          inSlurm: true,
          state: 'IDLE',
          stateFlags: [],
          availability: 'available',
          reason: null,
          partitions: [],
          cpus: 4,
          allocCpus: 0,
          cpuLoadBucket: null,
          totalMemoryMiB: 1000,
          allocMemoryMiB: 0,
          gpus: 0,
          allocGpus: 0,
        },
      ],
    });
    const container = screen.getByRole('list', { name: 'Test pod (2 racks)' }) as HTMLElement;
    expect(container.style.backgroundSize).toBe('20px 20px');
  });
});

describe('RacksGrid fullscreen toggle', () => {
  test('toggles between "Fullscreen" and "Exit fullscreen", and switches on a fixed-viewport class', async () => {
    renderGrid();
    const user = userEvent.setup();

    const button = screen.getByRole('button', { name: 'Fullscreen' });
    expect(button.getAttribute('aria-pressed')).toBe('false');

    // jsdom has no real Element.requestFullscreen, so this exercises the
    // CSS-fallback path.
    await user.click(button);
    const exitButton = screen.getByRole('button', { name: 'Exit fullscreen' });
    expect(exitButton.getAttribute('aria-pressed')).toBe('true');
    expect(exitButton.closest('.fixed.inset-0')).not.toBeNull();

    await user.click(exitButton);
    expect(screen.getByRole('button', { name: 'Fullscreen' }).getAttribute('aria-pressed')).toBe('false');
  });

  test('fullscreen is independent of which rack content is shown — toggling it does not need racks or flatNodes to change', async () => {
    renderGrid({ racks: [] });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Fullscreen' }));
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeTruthy();
  });
});

describe('RacksGrid filters live inside the component', () => {
  test('renders the search/status/partition/color/density controls alongside the racks', () => {
    renderGrid({ partitions: ['nova'] });
    expect(screen.getByLabelText('Search node')).toBeTruthy();
    expect(screen.getByLabelText('Status')).toBeTruthy();
    expect(screen.getByLabelText('Partition')).toBeTruthy();
    expect(screen.getByLabelText('Color by')).toBeTruthy();
    expect(screen.getByLabelText('View')).toBeTruthy();
  });

  test('shows the combined-view checkbox only when combinedViewAvailable', () => {
    renderGrid({ combinedViewAvailable: false });
    expect(screen.queryByLabelText('Combined view')).toBeNull();

    renderGrid({ combinedViewAvailable: true });
    expect(screen.getByLabelText('Combined view')).toBeTruthy();
  });
});
