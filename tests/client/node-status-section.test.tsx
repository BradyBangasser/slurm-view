/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildDummyTopology } from '../../src/client/features/nodes/dummy-topology';
import { NodeStatusSection } from '../../src/client/features/nodes/NodeStatusSection';
import { CURRENT_USER, DEFAULT_FILTERS, nodeMatches } from '../../src/client/features/nodes/topology';
import type { RackNode } from '../../src/client/features/nodes/topology';

function placedNodes(): RackNode[] {
  return buildDummyTopology().racks.flatMap((rack) =>
    rack.items.flatMap((item) => item.bays.filter((bay): bay is RackNode => bay !== null)),
  );
}

describe('buildDummyTopology', () => {
  test('is deterministic and gives every node a unique name', () => {
    expect(buildDummyTopology()).toEqual(buildDummyTopology());
    const topology = buildDummyTopology();
    const names = [...placedNodes(), ...topology.unplaced].map((node) => node.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('includes multi-node items (e.g. 2U Quad) and taller single-node items', () => {
    const topology = buildDummyTopology();
    const items = topology.racks.flatMap((rack) => rack.items);
    expect(items.some((item) => item.bays.length > 1)).toBe(true);
    expect(items.some((item) => item.heightU > 1 && item.bays.length === 1)).toBe(true);
  });
});

describe('nodeMatches', () => {
  const node: RackNode = {
    name: 'nova-gpu012',
    status: 'mixed',
    slurmState: 'MIXED',
    partitions: ['gpu'],
    jobs: ['train'],
    users: [CURRENT_USER],
    accounts: ['cs-ml'],
    reason: null,
  };

  test('matches name substrings case-insensitively', () => {
    expect(nodeMatches(node, 'GPU01', DEFAULT_FILTERS)).toBe(true);
    expect(nodeMatches(node, 'cpu', DEFAULT_FILTERS)).toBe(false);
    expect(nodeMatches(node, '  ', DEFAULT_FILTERS)).toBe(true);
  });

  test('applies the status filter', () => {
    expect(nodeMatches(node, '', { ...DEFAULT_FILTERS, status: 'mixed' })).toBe(true);
    expect(nodeMatches(node, '', { ...DEFAULT_FILTERS, status: 'idle' })).toBe(false);
  });

  test('applies the account filter', () => {
    expect(nodeMatches(node, '', { ...DEFAULT_FILTERS, account: 'cs-ml' })).toBe(true);
    expect(nodeMatches(node, '', { ...DEFAULT_FILTERS, account: 'bio-genomics' })).toBe(false);
  });

  test('applies the "my nodes" filter', () => {
    expect(nodeMatches(node, '', { ...DEFAULT_FILTERS, mineOnly: true })).toBe(true);
    expect(nodeMatches({ ...node, users: ['amurphy'] }, '', { ...DEFAULT_FILTERS, mineOnly: true })).toBe(false);
  });
});

describe('NodeStatusSection', () => {
  test('legend shows how many nodes are in each status', () => {
    render(<NodeStatusSection />);
    const topology = buildDummyTopology();
    const idleCount = [...placedNodes(), ...topology.unplaced].filter((node) => node.status === 'idle').length;
    const idleItem = screen.getByText('Idle', { selector: 'li' });
    expect(idleItem.textContent).toBe(`Idle(${idleCount})`);
  });

  test('renders one button per node across racks and the unplaced group', () => {
    render(<NodeStatusSection />);
    const topology = buildDummyTopology();
    expect(screen.getAllByRole('list', { name: /^Rack R/ })).toHaveLength(topology.racks.length);
    expect(screen.getAllByRole('button')).toHaveLength(placedNodes().length + topology.unplaced.length);
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

  test('"My nodes" dims nodes not owned by the current user', async () => {
    render(<NodeStatusSection />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('My nodes'));

    const nodes = placedNodes();
    const mine = nodes.find((node) => node.users.includes(CURRENT_USER));
    const notMine = nodes.find((node) => !node.users.includes(CURRENT_USER));
    expect(mine).toBeTruthy();
    expect(notMine).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(`^${mine!.name}:`) }).className).not.toContain(
      'opacity-20',
    );
    expect(screen.getByRole('button', { name: new RegExp(`^${notMine!.name}:`) }).className).toContain(
      'opacity-20',
    );
  });

  test('hovering a node previews it in the detail panel', async () => {
    render(<NodeStatusSection />);
    const user = userEvent.setup();
    const node = placedNodes().find((candidate) => candidate.jobs.length > 0)!;

    const panel = screen.getByRole('complementary', { name: 'Node details' });
    expect(panel.textContent).not.toContain(node.name);

    await user.hover(screen.getByRole('button', { name: new RegExp(`^${node.name}:`) }));

    expect(panel.textContent).toContain(node.name);
    expect(panel.textContent).toContain(node.jobs[0]);
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.unhover(screen.getByRole('button', { name: new RegExp(`^${node.name}:`) }));
    expect(panel.textContent).not.toContain(node.name);
  });

  test('clicking a node pins the detail panel open until closed', async () => {
    render(<NodeStatusSection />);
    const user = userEvent.setup();
    const node = placedNodes()[0]!;
    const button = screen.getByRole('button', { name: new RegExp(`^${node.name}:`) });

    await user.click(button);

    const panel = screen.getByRole('dialog', { name: 'Node details' });
    expect(panel.textContent).toContain(node.name);

    await user.unhover(button);
    expect(screen.getByRole('dialog', { name: 'Node details' }).textContent).toContain(node.name);

    await user.click(screen.getByRole('button', { name: 'Close node details' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
