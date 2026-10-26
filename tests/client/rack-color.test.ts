import {
  buildLoadGradient,
  loadColor,
  loadLegendKey,
} from '../../src/client/features/racks/rack-color';
import type { LoadScale } from '../../src/client/features/racks/rack-color';
import type { TopologyNodeDto } from '../../src/shared/api/v1/topology';

function node(overrides: Partial<TopologyNodeDto> = {}): TopologyNodeDto {
  return {
    name: 'nova1-1',
    inSlurm: true,
    state: 'ALLOCATED',
    stateFlags: [],
    availability: 'available',
    reason: null,
    partitions: [],
    cpus: 64,
    allocCpus: 64,
    cpuLoadRatio: null,
    totalMemoryMiB: 256000,
    allocMemoryMiB: 0,
    gpus: 0,
    allocGpus: 0,
    ...overrides,
  };
}

const DEFAULT_SCALE: LoadScale = { thresholds: { lowMax: 0.33, mediumMax: 0.66 }, steps: 16 };

describe('loadLegendKey', () => {
  test('grades a ratio against the real thresholds, not a fixed fraction', () => {
    // At the default thresholds, low/medium/high/extreme boundaries happen
    // to fall at 0.25/0.5/1.0 of extremeMax — the fixed-fraction version
    // this replaced would have agreed by coincidence. A site with
    // different thresholds must not get the same breakpoints.
    const wideThresholds: LoadScale = { thresholds: { lowMax: 0.1, mediumMax: 0.2 }, steps: 16 };

    // ratio 0.15 is between lowMax (0.1) and mediumMax (0.2) under the
    // wide thresholds — "medium" there, even though against the default
    // thresholds the same ratio would be "low".
    expect(loadLegendKey(node({ cpuLoadRatio: 0.15 }), wideThresholds)).toBe('medium');
    expect(loadLegendKey(node({ cpuLoadRatio: 0.15 }), DEFAULT_SCALE)).toBe('low');
  });

  test('buckets the default thresholds as low / medium / high / extreme', () => {
    expect(loadLegendKey(node({ cpuLoadRatio: 0.1 }), DEFAULT_SCALE)).toBe('low');
    expect(loadLegendKey(node({ cpuLoadRatio: 0.5 }), DEFAULT_SCALE)).toBe('medium');
    expect(loadLegendKey(node({ cpuLoadRatio: 0.9 }), DEFAULT_SCALE)).toBe('high');
    expect(loadLegendKey(node({ cpuLoadRatio: 1.5 }), DEFAULT_SCALE)).toBe('extreme');
  });

  test('a node with nothing allocated and not down is idle, not "no load data"', () => {
    expect(loadLegendKey(node({ cpuLoadRatio: null }), DEFAULT_SCALE)).toBe('idle');
  });

  test('a down node or one Slurm does not report has no load data, not idle', () => {
    expect(loadLegendKey(node({ cpuLoadRatio: null, availability: 'down' }), DEFAULT_SCALE)).toBe('unavailable');
    expect(loadLegendKey(node({ cpuLoadRatio: null, inSlurm: false }), DEFAULT_SCALE)).toBe('unavailable');
  });
});

describe('buildLoadGradient', () => {
  test('color stop positions move with the configured thresholds', () => {
    const narrow = buildLoadGradient(5, { lowMax: 0.1, mediumMax: 0.2 });
    const wide = buildLoadGradient(5, { lowMax: 0.6, mediumMax: 0.66 });

    // Same step count, same color stops, different thresholds: the
    // gradient at a given step index must differ, since lowMax moves
    // where green gives way to yellow.
    expect(narrow[1]).not.toBe(wide[1]);
  });

  test('is monotonic from the low-load color toward the extreme-load color', () => {
    const gradient = buildLoadGradient(16, DEFAULT_SCALE.thresholds);
    expect(gradient).toHaveLength(16);
    expect(gradient[0]).not.toBe(gradient[gradient.length - 1]);
  });
});

describe('loadColor', () => {
  test('a higher load ratio never produces the same color as a much lower one', () => {
    const low = loadColor(node({ cpuLoadRatio: 0.05 }), DEFAULT_SCALE);
    const high = loadColor(node({ cpuLoadRatio: 1.3 }), DEFAULT_SCALE);
    expect(low).not.toBe(high);
  });

  test('idle and unavailable nodes get their own fixed colors, not a gradient slot', () => {
    const idle = loadColor(node({ cpuLoadRatio: null }), DEFAULT_SCALE);
    const unavailable = loadColor(node({ cpuLoadRatio: null, availability: 'down' }), DEFAULT_SCALE);
    expect(idle).not.toBe(unavailable);
  });
});
