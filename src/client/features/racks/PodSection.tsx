import type { ReactNode } from 'react';
import { RacksGrid } from './RacksGrid.tsx';
import type { RacksGridControlsProps } from './RacksGrid.tsx';
import { sortByRackOrder } from './rack-order.ts';
import type { TopologyPodDto } from '../../../shared/api/v1/topology.ts';

interface PodSectionProps extends RacksGridControlsProps {
  pod: TopologyPodDto;
  rackHeight: number;
  // Per-user preferences from ui-settings (Settings page); see RacksGrid
  // for how maxRacksPerRow is enforced and rack-order.ts for how
  // rackOrder is applied on top of the default grid-column order below.
  maxRacksPerRow?: number;
  rackOrder?: string[];
  tabsSlot?: ReactNode;
}

// Computes one pod's racks (ordered by floor column, then the user's saved
// rackOrder) and hands everything else straight to RacksGrid, which owns
// the actual rendering, filters, legend, detail panel and fullscreen.
function PodSection({ pod, rackHeight, maxRacksPerRow, rackOrder, tabsSlot, ...controls }: PodSectionProps) {
  const gridSorted = [...pod.racks].sort((a, b) => (a.grid?.column ?? 0) - (b.grid?.column ?? 0));
  const racks = sortByRackOrder(gridSorted.map((rack) => ({ rack })), rackOrder ?? []);
  return (
    <RacksGrid
      title={`${pod.name} pod (${racks.length} racks)`}
      racks={racks}
      rackHeight={rackHeight}
      maxRacksPerRow={maxRacksPerRow}
      tabsSlot={tabsSlot}
      {...controls}
    />
  );
}

export { PodSection };
