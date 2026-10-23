import type { ColorMode } from './rack-color.ts';
import type { RackDensity } from './rack-density.ts';
import { RACK_NODE_STATUSES, RACK_NODE_STATUS_LABELS } from './rack-status.ts';
import type { RackFilters, StatusFilter } from './rack-filters.ts';

interface RacksFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  filters: RackFilters;
  onFiltersChange: (filters: RackFilters) => void;
  partitions: string[];
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
  density: RackDensity;
  onDensityChange: (density: RackDensity) => void;
}

// Search dims non-matching nodes rather than removing them, so rack
// positions stay put (decision recorded in milestone-3d-view.md).
function RacksFilters({
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  partitions,
  colorMode,
  onColorModeChange,
  density,
  onDensityChange,
}: RacksFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="flex flex-col text-sm text-gray-700">
        View
        <select
          value={density}
          onChange={(event) => onDensityChange(event.target.value as RackDensity)}
          className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="compact">Compact</option>
          <option value="full">Full scale</option>
        </select>
      </label>
      <label className="flex flex-col text-sm text-gray-700">
        Color by
        <select
          value={colorMode}
          onChange={(event) => onColorModeChange(event.target.value as ColorMode)}
          className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="status">Status</option>
          <option value="load">CPU load</option>
        </select>
      </label>
      <label className="flex flex-col text-sm text-gray-700">
        Search node
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Node name"
          className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="flex flex-col text-sm text-gray-700">
        Status
        <select
          value={filters.status}
          onChange={(event) => onFiltersChange({ ...filters, status: event.target.value as StatusFilter })}
          className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="all">All</option>
          {RACK_NODE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {RACK_NODE_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-sm text-gray-700">
        Partition
        <select
          value={filters.partition}
          onChange={(event) => onFiltersChange({ ...filters, partition: event.target.value })}
          className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="all">All</option>
          {partitions.map((partition) => (
            <option key={partition} value={partition}>
              {partition}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export { RacksFilters };
