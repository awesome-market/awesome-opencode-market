/** Bounded auto-retry semantics for a failed verification slot (V-3).
 *  Extracted from plan.ts so diagnose can share the EXACT predicate — a
 *  retryable failure is "verify still owns this slot", not a terminal
 *  package verdict. plan.ts re-exports; new consumers import here to
 *  avoid the diagnose ↔ plan import cycle. */
import type { PluginEntry } from '../../src/schema.ts'

export const FAILED_RETRY_WINDOW_MS = 7 * 86_400_000
export const MAX_FAILED_ATTEMPTS = 3

/** A failed slot gets bounded automatic retries: recent failure (within
 *  7d) + fewer than 3 recorded attempts re-enters the verify queue. Beyond
 *  that the version is genuinely dead — the only remaining path is manual
 *  --retest. */
export function retryable(v: PluginEntry['verification'] | undefined, now: Date): boolean {
  if (v?.status !== 'failed' || (v.retries ?? 0) >= MAX_FAILED_ATTEMPTS) return false
  const at = Date.parse(v.verifiedAt ?? '')
  return Number.isFinite(at) && now.getTime() - at < FAILED_RETRY_WINDOW_MS
}
