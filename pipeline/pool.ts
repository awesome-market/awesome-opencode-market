/** Bounded concurrent map: `concurrency` workers pull the next index as they free up. */
export const mapPool = async <T>(
  items: readonly T[],
  concurrency: number,
  fn: (x: T, i: number) => Promise<void>,
): Promise<void> => {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      await fn(items[i]!, i)
    }
  }))
}
