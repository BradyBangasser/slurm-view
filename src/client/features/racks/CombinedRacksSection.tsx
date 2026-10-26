import { RacksGrid } from './RacksGrid.tsx';
import type { RacksGridControlsProps } from './RacksGrid.tsx';
import { sortByRackOrder } from './rack-order.ts';
import type { TopologyPodDto } from '../../../shared/api/v1/topology.ts';

interface CombinedRacksSectionProps extends RacksGridControlsProps {
  pods: TopologyPodDto[];
  rackHeight: number;
  // See PodSection.tsx — same per-user ui-settings preferences, applied
  // across every pod's racks instead of within just one.
  maxRacksPerRow?: number;
  rackOrder?: string[];
}

// "Combined view" from Meeting 5 (see docs/meeting5.md): pulls every pod's
// racks into one view instead of switching between per-pod tabs, so a
// cross-pod filter (e.g. one partition that spans GPU and Compute) shows
// its matches side by side rather than scattered across tabs the user has
// to click through one at a time. A manual toggle in the filter column
// (RacksFilters.tsx, rendered by RacksGrid), not an automatic switch when a
// filter narrows the result set — the meeting notes left that choice open;
// this is the resolution, consistent with the recap's framing of it as an
// explicit view a user opts into.
//
// Racks sort by pod name first so a pod's racks stay grouped even though
// they're no longer under their own heading, then by floor column within
// the pod, matching PodSection's single-pod ordering.
function CombinedRacksSection({ pods, rackHeight, maxRacksPerRow, rackOrder, ...controls }: CombinedRacksSectionProps) {
  const gridSorted = pods
    .flatMap((pod) => pod.racks.map((rack) => ({ rack, podName: pod.name })))
    .sort((a, b) => a.podName.localeCompare(b.podName) || (a.rack.grid?.column ?? 0) - (b.rack.grid?.column ?? 0));
  const racks = sortByRackOrder(gridSorted, rackOrder ?? []);

  return (
    <RacksGrid
      title={`All pods, combined (${racks.length} racks)`}
      racks={racks}
      rackHeight={rackHeight}
      wrap
      maxRacksPerRow={maxRacksPerRow}
      {...controls}
    />
  );
}

export { CombinedRacksSection };
