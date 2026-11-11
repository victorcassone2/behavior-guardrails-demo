/**
 * Serializes async work per key, so a check-then-write on one voucher or one
 * payment cannot interleave with another request for the same key.
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>()

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(work)
    this.tails.set(key, current)
    try {
      return await current
    } finally {
      if (this.tails.get(key) === current) this.tails.delete(key)
    }
  }
}
