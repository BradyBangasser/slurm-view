/** @jest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildDummyTopology } from '../../src/client/features/nodes/dummy-topology';
import { NodeStatusSection } from '../../src/client/features/nodes/NodeStatusSection';
import { nodeMatches } from '../../src/client/features/nodes/topology';
import type { RackNode } from '../../src/client/features/nodes/topology';

function placedNodes(): RackNode[] {
  return buildDummyTopology().racks.flatMap((rack) =>
    rack.slots.flatMap((slot) => (slot.node === null ? [] : [slot.node])),
  );
}

describe('buildDummyTopology', () => {
  test('is deterministic and gives every node a unique name', () => {
    expect(buildDummyTopology()).toEqual(buildDummyTopology());
    const topology = buildDummyTopology();
    const names = [...placedNodes(), ...topology.unplaced].map((node) => node.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('nodeMatches', () => {
  const node: RackNode = {
    name: 'nova-gpu012',
    status: 'mixed',
    slurmState: 'MIXED',
    partitions: ['gpu'],
    jobs: ['train'],
    reason: null,
  };

  test('matches name substrings case-insensitively', () => {
    expect(nodeMatches(node, 'GPU01', 'all')).toBe(true);
    expect(nodeMatches(node, 'cpu', 'all')).toBe(false);
    expect(nodeMatches(node, '  ', 'all')).toBe(true);
  });

  test('applies the status filter', () => {
    expect(nodeMatches(node, '', 'mixed')).toBe(true);
    expect(nodeMatches(node, '', 'idle')).toBe(false);
  });
});

describe('NodeStatusSection', () => {
  test('renders one button per node across racks and the unplaced group', () => {
    render(<NodeStatusSection />);
    const topology = buildDummyTopology();
    expect(screen.getAllByRole('list', { name: /^Rack R/ })).toHaveLength(topology.racks.length);
    expect(screen.getAllByRole('button')).toHaveLength(placedNodes().length + topology.unplaced.length);
  });

  test('tooltip describes the node id, status and job', () => {
    render(<NodeStatusSection />);
    const node = placedNodes().find((candidate) => candidate.jobs.length > 0)!;
    const button = screen.getByRole('button', { name: new RegExp(`^${node.name}:`) });
    const tooltip = document.getElementById(button.getAttribute('aria-describedby')!)!;
    expect(within(tooltip).getByText(node.name)).toBeTruthy();
    expect(tooltip.textContent).toContain(node.jobs[0]);
  });

  test('search dims non-matching nodes and reports the match count', async () => {
    render(<NodeStatusSection />);
    const user = userEvent.setup();
    const target = placedNodes()[0]!;

    await user.type(screen.getByLabelText('Search Node:'), target.name);

    expect(screen.getByRole('status').textContent).toMatch(/^1 of \d+ nodes match$/);
    const match = screen.getByRole('button', { name: new RegExp(`^${target.name}:`) });
    expect(match.className).not.toContain('opacity-20');
    const other = screen.getByRole('button', { name: new RegExp(`^${placedNodes()[1]!.name}:`) });
    expect(other.className).toContain('opacity-20');
  });

  test('status filter dims nodes with other statuses', async () => {
    render(<NodeStatusSection />);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText('Filter By:'), 'down');

    for (const button of screen.getAllByRole('button')) {
      const dimmed = button.className.includes('opacity-20');
      expect(dimmed).toBe(button.getAttribute('data-status') !== 'down');
    }
  });
});
