/** Fisher–Yates; returns a new array. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A fresh lap through the crate that doesn't start with `avoidFirst` (the record that just finished). */
export function newLap(ids: readonly string[], random: () => number, avoidFirst: string | null): string[] {
  const order = shuffle(ids, random);
  if (avoidFirst !== null && order.length > 1 && order[0] === avoidFirst) {
    const swapWith = 1 + Math.floor(random() * (order.length - 1));
    [order[0], order[swapWith]] = [order[swapWith], order[0]];
  }
  return order;
}

/**
 * Fit a saved play order to an edited crate: played records and the current one keep their
 * places, removed ids drop out, and new ids are inserted at random into the unplayed part.
 */
export function reconcileOrder(
  order: readonly string[],
  pos: number,
  crateIds: readonly string[],
  random: () => number,
): { order: string[]; pos: number; currentRemoved: boolean } {
  const present = new Set(crateIds);
  const current = order[pos];
  const currentRemoved = current !== undefined && !present.has(current);
  const played = order.slice(0, pos).filter((id) => present.has(id));
  const upcoming = order.slice(pos + 1).filter((id) => present.has(id));
  const known = new Set(order);
  for (const id of crateIds) {
    if (!known.has(id)) upcoming.splice(Math.floor(random() * (upcoming.length + 1)), 0, id);
  }
  const head = current !== undefined && !currentRemoved ? [current] : [];
  return { order: [...played, ...head, ...upcoming], pos: played.length, currentRemoved };
}
