/** Bounded auto-retry semantics for a failed verification slot (V-3).
 *  Extracted from plan.ts so diagnose can share the EXACT predicate — a
 *  retryable failure is "verify still owns this slot", not a terminal
 *  package verdict. plan.ts re-exports; new consumers import here to
 *  avoid the diagnose ↔ plan import cycle. */
import type { PluginEntry } from '../../src/schema.ts'

export const MAX_FAILED_ATTEMPTS = 3

/** A failed slot gets bounded automatic retries: fewer than 3 recorded
 *  attempts re-enters the verify queue. Beyond that the version is
 *  genuinely dead — the only remaining path is manual --retest.
 *  Deliberately NOT wall-clock bounded: the old 7d window expired while a
 *  target waited in a deep queue — 'queue delay' and 'retry budget spent'
 *  were conflated, so a slot could hit terminal-failed having used zero of
 *  its 3 attempts. The attempts counter alone is the budget; each retry
 *  only lands when a shard actually measures the slot. */
export function retryable(v: PluginEntry['verification'] | undefined): boolean {
  return v?.status === 'failed' && (v.retries ?? 0) < MAX_FAILED_ATTEMPTS
}
