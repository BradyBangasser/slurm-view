// Applies a user's saved rack order (ui-settings' topology.rackOrder) on
// top of whatever order the caller already computed (grid-column order,
// or pod-name-then-column for the combined view). Racks the user has
// ordered move to the front, in that order; everything else keeps its
// existing relative order (Array.prototype.sort is stable), which also
// covers ids the user ordered that have since been retired or renamed —
// they're simply absent from `order` and change nothing.
function sortByRackOrder<T extends { rack: { id: string } }>(items: T[], order: string[]): T[] {
  if (order.length === 0) {
    return items;
  }

  const indexOf = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((a, b) => {
    const aIndex = indexOf.get(a.rack.id);
    const bIndex = indexOf.get(b.rack.id);
    if (aIndex !== undefined && bIndex !== undefined) {
      return aIndex - bIndex;
    }
    if (aIndex !== undefined) {
      return -1;
    }
    if (bIndex !== undefined) {
      return 1;
    }
    return 0;
  });
}

export { sortByRackOrder };
