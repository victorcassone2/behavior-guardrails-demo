export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }

/** A clock tests can hold still and move by hand. */
export interface ManualClock extends Clock {
  set(iso: string): void
  advance(ms: number): void
}

export function manualClock(startIso: string): ManualClock {
  let current = new Date(startIso).getTime()
  return {
    now: () => new Date(current),
    set: (iso) => {
      current = new Date(iso).getTime()
    },
    advance: (ms) => {
      current += ms
    },
  }
}
