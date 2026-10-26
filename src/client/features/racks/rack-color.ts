import { RACK_NODE_STATUS_CLASSES, RACK_NODE_STATUS_LABELS, rackNodeStatus } from './rack-status.ts';
import type { TopologyLoadThresholds, TopologyNodeDto, TopologyRackDto } from '../../../shared/api/v1/topology.ts';

// Everything the load color mode needs to grade a raw `cpuLoadRatio` into a
// display bucket: the site's CPU-load thresholds (same ones the stats chart
// uses — `TopologyResponse.loadThresholds`) and the gradient's step count
// (`TopologyResponse.loadGradientSteps`). Bundled so callers thread one prop
// instead of two down the RacksGrid → RackColumn → RackBox → NodeSlot chain.
interface LoadScale {
  thresholds: TopologyLoadThresholds;
  steps: number;
}

// Rack-enclosure classification (distinct from the per-node colorMode
// above): a rack is "gpu" only if every node it holds has a GPU, "cpu"
// otherwise. Used to tint the rack's own frame in RackColumn.tsx, not the
// node boxes inside it — a rack that mixes GPU and CPU-only nodes (e.g. a
// compute node like BD36/BN36 sharing an enclosure with a GPU node) reads
// as "cpu" rather than painting every node in it green, which would
// misrepresent nodes that have no GPU at all.

type RackHardwareKind = 'gpu' | 'cpu';

// Frame fill is the hardware color itself (a mid-dark shade, saturated
// enough to read as "emerald"/"sky" rather than nearly-black), not just a
// colored outline around an otherwise-neutral enclosure.
const RACK_HARDWARE_BORDER_CLASSES: Record<RackHardwareKind, string> = {
  gpu: 'border-emerald-500 bg-emerald-800',
  cpu: 'border-sky-500 bg-sky-800',
};

// Background-only variant for surfaces nested inside the frame above (the
// empty-segment filler in RackColumn.tsx) that would otherwise paint over
// it with the neutral slate background.
const RACK_HARDWARE_BG_CLASSES: Record<RackHardwareKind, string> = {
  gpu: 'bg-emerald-800',
  cpu: 'bg-sky-800',
};

function rackHardwareKind(rack: TopologyRackDto): RackHardwareKind {
  const nodes = rack.boxes.flatMap((box) => box.nodes);
  const allGpu = nodes.length > 0 && nodes.every((node) => (node.gpus ?? 0) > 0);
  return allGpu ? 'gpu' : 'cpu';
}

// Color-mode toggle pulled forward from the 3-D plan (milestone-3d-view.md
// lists status / CPU load / memory / GPU as color modes; Meeting 4 asked
// for load specifically, in 2-D, ahead of the rest). "status" is the
// default; "load" recolors by cpuLoadRatio (graded via LoadScale) instead.
type ColorMode = 'status' | 'load';

// Legend/grouping categories for load mode. "idle" and "unavailable" both
// have no cpuLoadRatio (nothing allocated to grade), but read differently:
// idle is a normal, healthy state (a node with nothing running), while
// unavailable covers down nodes and nodes Slurm reports no load for. The
// rest bucket the raw ratio against the site's real thresholds, for a
// legend that doesn't need 16-32 rows.
type LoadLegendKey = 'idle' | 'low' | 'medium' | 'high' | 'extreme' | 'unavailable';

const LOAD_LEGEND_KEYS: readonly LoadLegendKey[] = ['idle', 'low', 'medium', 'high', 'extreme', 'unavailable'];

// Weather-radar-style scale (Meeting 5 / Zoom recap): green (low) through
// yellow, orange and red (high) to purple (extreme). Each node's color is
// picked by grading its raw `cpuLoadRatio` into one of
// `TopologyResponse.loadGradientSteps` discrete steps, positioned against
// the site's real `loadThresholds` (see loadGradientStopPositions below) —
// so the colors genuinely track CPU load and the site's configured
// boundaries, not a fixed assumption about where they fall. Idle gets its
// own blue, distinct from the gray used for
// down/no-data nodes — the manual notes named blue for idle; the recap's
// palette didn't repeat it, so this is the carried-forward value pending
// team confirmation (see milestone-3d-view.md open questions).
const LOAD_GRADIENT_STOPS: readonly [number, number, number][] = [
  [52, 211, 153], // emerald-400 — low
  [250, 204, 21], // yellow-400
  [251, 146, 60], // orange-400
  [220, 38, 38], // red-600 — high
  [168, 85, 247], // purple-500 — extreme
];

const LOAD_IDLE_COLOR = 'rgb(56, 189, 248)'; // sky-400
const LOAD_UNAVAILABLE_COLOR = 'rgb(148, 163, 184)'; // slate-400

const LOAD_LEGEND_COLORS: Record<LoadLegendKey, string> = {
  idle: LOAD_IDLE_COLOR,
  low: rgbString(LOAD_GRADIENT_STOPS[0]!),
  medium: rgbString(LOAD_GRADIENT_STOPS[1]!),
  high: rgbString(LOAD_GRADIENT_STOPS[3]!),
  extreme: rgbString(LOAD_GRADIENT_STOPS[4]!),
  unavailable: LOAD_UNAVAILABLE_COLOR,
};

const LOAD_LABELS: Record<LoadLegendKey, string> = {
  idle: 'Idle',
  low: 'Low load',
  medium: 'Medium load',
  high: 'High load',
  extreme: 'Extreme load',
  unavailable: 'No load data',
};

function rgbString([r, g, b]: readonly [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Position of a raw load ratio within a `steps`-step gradient (0 = lowest,
// steps - 1 = most extreme). Extends the low/medium/high domain above
// mediumMax: a ratio of 2x mediumMax or higher is "extreme" and always
// grades to the top step; between mediumMax and that point grades linearly.
// This used to live on the server (which pre-bucketed every node into a
// step); now that the backend sends the raw `cpuLoadRatio` instead, grading
// happens here, against the site's config echoed back on `TopologyResponse`.
function gradeLoadStep(ratio: number, thresholds: TopologyLoadThresholds, steps: number): number {
  const extremeMax = thresholds.mediumMax * 2;
  const clamped = Math.min(Math.max(ratio, 0), extremeMax);
  const step = Math.floor((clamped / extremeMax) * steps);
  return Math.min(step, steps - 1);
}

// Where each color stop above sits in the 0..1 domain (0 = ratio 0, 1 =
// extremeMax), derived from the site's actual thresholds instead of
// spacing the five colors evenly. Without this, the gradient's green→
// yellow→orange→red→purple transitions land at arbitrary ratios that only
// happen to match `lowMax`/`mediumMax` for the *default* thresholds
// (0.33/0.66) — any site that configures different values would get a
// gradient that no longer agrees with where its own low/medium/high
// boundaries actually are. mediumMax's position is always exactly 0.5
// here since extremeMax is defined as 2x mediumMax; only lowMax's position
// varies with config.
function loadGradientStopPositions(thresholds: TopologyLoadThresholds): readonly number[] {
  const extremeMax = thresholds.mediumMax * 2;
  const lowPosition = extremeMax > 0 ? thresholds.lowMax / extremeMax : 0;
  const mediumPosition = extremeMax > 0 ? thresholds.mediumMax / extremeMax : 0.5;
  const highPosition = (mediumPosition + 1) / 2;
  return [0, lowPosition, mediumPosition, highPosition, 1];
}

// One color per step (0 .. steps - 1), interpolated across the gradient
// stops above at the positions `thresholds` puts them. `steps` comes from
// the site's `topology.load.gradientSteps` config (default 16; Meeting 5
// asked for 16 or 32); `thresholds` is the same `lowMax`/`mediumMax` the
// stats CPU chart grades against (`TopologyResponse.loadThresholds`).
function buildLoadGradient(steps: number, thresholds: TopologyLoadThresholds): string[] {
  if (steps <= 1) {
    return [rgbString(LOAD_GRADIENT_STOPS[0]!)];
  }
  const positions = loadGradientStopPositions(thresholds);
  const colors: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    const position = i / (steps - 1);
    let segment = 0;
    while (segment < positions.length - 2 && position > positions[segment + 1]!) {
      segment += 1;
    }
    const segmentStart = positions[segment]!;
    const segmentEnd = positions[segment + 1]!;
    const t = segmentEnd > segmentStart ? (position - segmentStart) / (segmentEnd - segmentStart) : 0;
    const from = LOAD_GRADIENT_STOPS[segment]!;
    const to = LOAD_GRADIENT_STOPS[segment + 1]!;
    colors.push(
      rgbString([
        Math.round(lerp(from[0], to[0], t)),
        Math.round(lerp(from[1], to[1], t)),
        Math.round(lerp(from[2], to[2], t)),
      ])
    );
  }
  return colors;
}

// Node is idle when it carries no load ratio but isn't down and isn't a
// layout entry Slurm doesn't report — the inverse of "there's a load
// number to show," which cpuLoadRatio already encodes for every other case.
function nodeIsIdle(node: TopologyNodeDto): boolean {
  return node.inSlurm && node.availability !== 'down' && node.cpuLoadRatio === null;
}

// Directly against the site's real thresholds — the same ones
// classifyCpuLoadBucket() uses for the stats chart, extended with
// "extreme" at 2x mediumMax — rather than a fixed fraction of the step
// index. That fixed-fraction version happened to agree with the default
// thresholds (lowMax 0.33, mediumMax 0.66 put the low/medium boundary at
// exactly 0.25 of extremeMax) but would silently disagree with any site
// that configures different values.
function loadLegendKey(node: TopologyNodeDto, scale: LoadScale): LoadLegendKey {
  if (node.cpuLoadRatio === null) {
    return nodeIsIdle(node) ? 'idle' : 'unavailable';
  }
  const { lowMax, mediumMax } = scale.thresholds;
  const ratio = node.cpuLoadRatio;
  if (ratio < lowMax) return 'low';
  if (ratio <= mediumMax) return 'medium';
  if (ratio < mediumMax * 2) return 'high';
  return 'extreme';
}

// The actual per-node color in load mode: the graded gradient color when
// there's a load ratio, else the idle/unavailable colors above.
function loadColor(node: TopologyNodeDto, scale: LoadScale): string {
  if (node.cpuLoadRatio === null) {
    return nodeIsIdle(node) ? LOAD_IDLE_COLOR : LOAD_UNAVAILABLE_COLOR;
  }
  const step = gradeLoadStep(node.cpuLoadRatio, scale.thresholds, scale.steps);
  const gradient = buildLoadGradient(scale.steps, scale.thresholds);
  return gradient[Math.min(step, gradient.length - 1)]!;
}

// Status mode stays on Tailwind classes (a fixed small palette). Load mode
// needs an arbitrary-sized gradient, which isn't expressible as a finite
// set of utility classes, so it's an inline style instead — see
// nodeColorStyle.
function nodeColorClass(node: TopologyNodeDto, mode: ColorMode): string {
  return mode === 'status' ? RACK_NODE_STATUS_CLASSES[rackNodeStatus(node)] : '';
}

// Pair with nodeColorClass: undefined in status mode (the Tailwind class
// above already colors the node), a background-color style in load mode.
function nodeColorStyle(node: TopologyNodeDto, mode: ColorMode, scale: LoadScale): { backgroundColor: string } | undefined {
  return mode === 'status' ? undefined : { backgroundColor: loadColor(node, scale) };
}

function nodeColorLabel(node: TopologyNodeDto, mode: ColorMode, scale: LoadScale): string {
  return mode === 'status' ? RACK_NODE_STATUS_LABELS[rackNodeStatus(node)] : LOAD_LABELS[loadLegendKey(node, scale)];
}

export {
  buildLoadGradient,
  gradeLoadStep,
  LOAD_IDLE_COLOR,
  LOAD_LABELS,
  LOAD_LEGEND_COLORS,
  LOAD_LEGEND_KEYS,
  LOAD_UNAVAILABLE_COLOR,
  loadColor,
  loadLegendKey,
  nodeColorClass,
  nodeColorLabel,
  nodeColorStyle,
  RACK_HARDWARE_BG_CLASSES,
  RACK_HARDWARE_BORDER_CLASSES,
  rackHardwareKind,
};
export type { ColorMode, LoadLegendKey, LoadScale, RackHardwareKind };
