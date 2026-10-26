import { RACK_NODE_STATUS_CLASSES, RACK_NODE_STATUS_LABELS, rackNodeStatus } from './rack-status.ts';
import type { TopologyNodeDto, TopologyRackDto } from '../../../shared/api/v1/topology.ts';

// Rack-enclosure classification (distinct from the per-node colorMode
// above): a rack is "gpu" if any node it holds has a GPU, "cpu" otherwise.
// Used to tint the rack's own frame in RackColumn.tsx, not the node boxes
// inside it.
type RackHardwareKind = 'gpu' | 'cpu';

const RACK_HARDWARE_BORDER_CLASSES: Record<RackHardwareKind, string> = {
  gpu: 'border-emerald-600 bg-emerald-950',
  cpu: 'border-sky-600 bg-sky-950',
};

// Background-only variant for surfaces nested inside the frame above (the
// empty-segment filler in RackColumn.tsx) that would otherwise paint over
// it with the neutral slate background.
const RACK_HARDWARE_BG_CLASSES: Record<RackHardwareKind, string> = {
  gpu: 'bg-emerald-950',
  cpu: 'bg-sky-950',
};

function rackHardwareKind(rack: TopologyRackDto): RackHardwareKind {
  const hasGpu = rack.boxes.some((box) => box.nodes.some((node) => (node.gpus ?? 0) > 0));
  return hasGpu ? 'gpu' : 'cpu';
}

// Color-mode toggle pulled forward from the 3-D plan (milestone-3d-view.md
// lists status / CPU load / memory / GPU as color modes; Meeting 4 asked
// for load specifically, in 2-D, ahead of the rest). "status" is the
// default; "load" recolors by cpuLoadBucket instead.
type ColorMode = 'status' | 'load';

// cpuLoadBucket is 'low' | 'medium' | 'high' | null, where null covers
// several different reasons (down, no allocation, or Slurm reporting no
// load — see the TopologyNodeDto doc comment). All of those read the same
// in this mode: there's no load number to show.
type LoadLegendKey = 'low' | 'medium' | 'high' | 'unavailable';

const LOAD_LEGEND_KEYS: readonly LoadLegendKey[] = ['low', 'medium', 'high', 'unavailable'];

// Weather-radar-style scale (Meeting 5): green (low) through yellow/orange
// to red (high), rather than the status palette's blue-to-red sky/amber/rose
// so the two modes don't look like they're both trying to say "status". True
// extreme (purple) and a finer 16/32-step gradient need a raw per-CPU load
// number from the backend — TopologyNodeDto only exposes the 3-bucket
// cpuLoadBucket today, so this stays a 3-step approximation of that palette
// until the DTO carries the raw value.
const LOAD_CLASSES: Record<LoadLegendKey, string> = {
  low: 'bg-emerald-400',
  medium: 'bg-amber-400',
  high: 'bg-rose-600',
  unavailable: 'bg-slate-400',
};

const LOAD_LABELS: Record<LoadLegendKey, string> = {
  low: 'Low load',
  medium: 'Medium load',
  high: 'High load',
  unavailable: 'No load data',
};

function loadLegendKey(node: TopologyNodeDto): LoadLegendKey {
  if (node.cpuLoadBucket === 'low') return 'low';
  if (node.cpuLoadBucket === 'medium') return 'medium';
  if (node.cpuLoadBucket === 'high') return 'high';
  return 'unavailable';
}

function nodeColorClass(node: TopologyNodeDto, mode: ColorMode): string {
  return mode === 'status' ? RACK_NODE_STATUS_CLASSES[rackNodeStatus(node)] : LOAD_CLASSES[loadLegendKey(node)];
}

function nodeColorLabel(node: TopologyNodeDto, mode: ColorMode): string {
  return mode === 'status' ? RACK_NODE_STATUS_LABELS[rackNodeStatus(node)] : LOAD_LABELS[loadLegendKey(node)];
}

export {
  LOAD_CLASSES,
  LOAD_LABELS,
  LOAD_LEGEND_KEYS,
  loadLegendKey,
  nodeColorClass,
  nodeColorLabel,
  RACK_HARDWARE_BG_CLASSES,
  RACK_HARDWARE_BORDER_CLASSES,
  rackHardwareKind,
};
export type { ColorMode, LoadLegendKey, RackHardwareKind };
