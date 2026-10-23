// View toggle for the rack elevation (RacksFilters.tsx "View" select):
// "full" draws every rack to the full rackHeight at a comfortably large
// unit size, so racks share one scale and nodes stay easy to click —
// tall racks need their own scrollbox to fit on screen (see PodSection.tsx).
// "compact" trims each rack down to only the units its boxes occupy and
// draws at a smaller unit size, trading the shared scale and some click-
// target size for a much shorter view that more often needs no scrolling
// at all. Default is "compact" since most of Nova's racks use a fraction
// of their 42U.
type RackDensity = 'full' | 'compact';

const DEFAULT_RACK_DENSITY: RackDensity = 'compact';

// Height of one rack unit in the elevation. A box's rendered height is a
// multiple of this (a 4U box is 4x as tall as a 1U box).
const UNIT_HEIGHT_PX: Record<RackDensity, number> = {
  full: 30,
  compact: 18,
};

// Width of the bay area inside a rack's rails. Nova's densest boxes are
// 2U, 4-node chassis (e.g. nova22-[1-4]); "full" is sized so a 4-wide bay
// stays a legible click target, "compact" trades some of that back for
// density.
const RACK_WIDTH_PX: Record<RackDensity, number> = {
  full: 160,
  compact: 120,
};

export { DEFAULT_RACK_DENSITY, RACK_WIDTH_PX, UNIT_HEIGHT_PX };
export type { RackDensity };
