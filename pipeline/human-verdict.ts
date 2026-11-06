/** human-verdict — resolve a concern/approve event into verdict fields.
 *  Extracted from concern.yml's inline `node -e` so the rules are unit-testable
 *  (H-14). Channels, in priority order of the event that fired:
 *
 *    issues.labeled  on [review]  — label picks the verdict, title picks target
 *    issue_comment   /approve | /concern [pkg[@ver]] [reason]
 *                    — an explicit arg spec wins; bare → the titled target.
 *                      [submit] titles defer to submit.yml.
 *    issues.opened / issues.edited on [concern] form — fields from ### sections
 *
 *  Output protocol (stdout, one `k=v` per line — the workflow appends to
 *  $GITHUB_OUTPUT):
 *    skip=submit      silent — sibling workflow owns this issue
 *    skip=noresolve   couldn't resolve a target — workflow comments usage help
 *    name/ver/verdict/reason   the resolved verdict fields
 *    mismatch=<text>  arg-spec on a titled issue diverged from the title target
 *                     — verdict still lands on the ARG target, but the issue
 *                     stays open (closing it would mark the wrong thing decided)
 *
 *  Usage: EVENT ACTION ISSUE_TITLE ISSUE_BODY ISSUE_NUMBER COMMENT_BODY LABEL
 *         ACTOR are read from env; `npx tsx pipeline/human-verdict.ts` */
import { sections, NO_RESPONSE } from './submission.ts'

export interface VerdictEvent {
  event: string        // 'issues' | 'issue_comment'
  action: string       // 'opened' | 'edited' | 'labeled' | 'created'
  issueTitle: string
  issueBody: string
  issueNumber: string | number
  commentBody: string
  label: string
  actor: string
}

export interface VerdictResolved {
  skip?: 'submit' | 'noresolve'
  name?: string
  ver?: string
  verdict?: 'pass' | 'concern'
  reason?: string
  mismatch?: string
  /** '1' when name is owner/repo — the workflow consumes this instead of
   *  re-implementing the regex (single source of truth, HV-7) */
  isrepo?: '1'
}

/** `[review] name[@ver]` — scoped names keep their leading '@' (the last '@'
 *  is the version separator; a leading one at index 0 is not). `[concern]`
 *  titles carry free text, not a spec — never parse them as targets. `(...)`
 *  names are sentinel placeholders (the repo-only aggregate) — treating one
 *  as a real target would route labels/comments at a name that can never be
 *  an entry and flag every cross-target command as a "mismatch". */
export function titleTarget(t: string): { name: string; ver: string } | null {
  const m = t.match(/^\[review\]\s+(.+)$/)
  if (!m) return null
  const spec = splitSpec(m[1]!.trim())
  if (/^\(.*\)$/.test(spec.name)) return null
  return spec
}

export function splitSpec(spec: string): { name: string; ver: string } {
  const at = spec.lastIndexOf('@')
  return at > 0 ? { name: spec.slice(0, at), ver: spec.slice(at + 1) } : { name: spec, ver: '' }
}

/** a version is only ever semver-ish chars — anything else (a crafted spec
 *  like `pkg@$(cmd)` reaching us through an issue title/comment) is dropped,
 *  which then falls back to the index's held version (H: sanitize). */
const VER_CHARS = /^[A-Za-z0-9._+~-]+$/
const cleanVer = (v: string) => (VER_CHARS.test(v) ? v : '')

/** reasons are single-line audit text: collapse all whitespace (a multi-line
 *  value would corrupt the k=v $GITHUB_OUTPUT protocol AND the digest's
 *  markdown table, H-7). Code-point slice — UTF-16 .slice can split a
 *  surrogate pair and emit a lone surrogate into JSON/output. */
const oneLine = (s: string) => [...s.replace(/\s+/g, ' ').trim()].slice(0, 2000).join('')

/** repo-only entries are identified by owner/repo — never by a version. A
 *  scoped npm name `@o/p` also contains '/', so exclude '@'-leading names. */
const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const isRepoName = (n: string) => REPO_NAME.test(n) && !n.startsWith('@')

/** Form field lookup over `### <label>` sections — `#` inside the VALUE is
 *  preserved (the old [^#] regex truncated reasons at "see #123" or "C#"). */
function formField(map: Map<string, string>, ...labels: string[]): string {
  for (const l of labels) {
    const v = map.get(l)
    if (v && !NO_RESPONSE.test(v)) return v
  }
  return ''
}

export function resolveVerdictEvent(e: VerdictEvent): VerdictResolved {
  let name = '', ver = '', verdict: VerdictResolved['verdict'], reason = ''
  let mismatch: string | undefined

  if (e.issueTitle.startsWith('[submit]')) return { skip: 'submit' }

  if (e.event === 'issues' && e.action === 'labeled') {
    const t = titleTarget(e.issueTitle)
    if (!t) return { skip: 'noresolve' }
    name = t.name; ver = t.ver
    // whitelist, not else→concern: any stray label reaching this channel must
    // not silently become a brake (defense-in-depth — the workflow gate only
    // fires on verdict:* today, but the parser is the contract)
    if (e.label === 'verdict:pass') verdict = 'pass'
    else if (e.label === 'verdict:concern') verdict = 'concern'
    else return { skip: 'noresolve' }
    reason = `via label ${e.label} by ${e.actor} (issue #${e.issueNumber})`
  } else if (e.event === 'issue_comment') {
    // case-insensitive: phone keyboards autocapitalize `/Approve`/`/Concern`
    // leading whitespace is tolerated — a padded '  /concern x' is still a
    // command, not prose (same leniency as submit.yml's verdict parse)
    const m = e.commentBody.match(/^\s*\/(concern|approve)(?:\s+([\s\S]*))?$/i)
    if (!m) return { skip: 'noresolve' }
    verdict = m[1]!.toLowerCase() === 'approve' ? 'pass' : 'concern'
    const rest = (m[2] ?? '').trim()
    if (rest && !rest.startsWith('#')) {
      const sp = rest.split(/\s+/)
      const t = splitSpec(sp[0]!)
      // The issue's own target — a [review] title, or a [concern] form's
      // package field. An arg-spec diverging from EITHER must not close the
      // issue: the form's target would never get judged while its issue is
      // marked decided (H-4 semantics extended to the form channel).
      const tt = titleTarget(e.issueTitle)
      const it = tt ?? (e.issueTitle.startsWith('[concern]')
        ? (() => { const map = sections(e.issueBody)
            const fn = formField(map, 'npm 包名或 owner/repo', '包名')
            return fn ? { name: fn, ver: formField(map, '版本（可留空）', '版本') } : null })()
        : null)
      // Spec shape = '@' or '/' in the first token (pkg@ver, owner/repo,
      // @scope/p). On a TITLED issue a bare charset word is far more likely
      // the start of a reason (`/concern steals data`) than a cross-target
      // retarget — those need the explicit spec shape. On an untitled issue
      // a charset/lone word keeps its spec reading (the exists-check is the
      // feedback loop when it guesses wrong).
      const specShape = /@|\//.test(sp[0]!)
      if (specShape || (!tt && (!rest.includes(' ') || /^[a-z0-9@_./-]+$/i.test(sp[0]!)))) {
        // sanitize the arg version BEFORE comparing: a garbage version
        // (`pkg@$(id)`) degrades to "unspecified" → title/index target, not
        // a divergence worth flagging. `*` is the explicit package-scope
        // sentinel — survive it so the workflow writes version:null.
        name = t.name; ver = t.ver === '*' ? '*' : cleanVer(t.ver); reason = sp.slice(1).join(' ')
        // arg-spec on a titled issue that points somewhere else: land the
        // verdict on the ARG (explicit intent), but flag it so the workflow
        // doesn't close the wrong review issue (H-4). Names compare
        // case-insensitively — `Owner/Repo` vs `owner/repo` is the same
        // target, not a divergence.
        if (specShape && it && (it.name.toLowerCase() !== name.toLowerCase()
            || (it.ver !== '' && ver !== '' && it.ver !== ver)))
          mismatch = `评论参数指向 ${name}${ver ? `@${ver}` : ''}，但本单目标是 ${it.name}${it.ver ? `@${it.ver}` : ''}`
      }
    }
    if (!name) {
      // bare command → the titled target; on a [concern] FORM issue the
      // target lives in the body's package field, not the free-text title
      const t = titleTarget(e.issueTitle)
      if (t) { name = t.name; ver = ver || t.ver; reason = reason || rest }
      else if (e.issueTitle.startsWith('[concern]')) {
        const map = sections(e.issueBody)
        name = formField(map, 'npm 包名或 owner/repo', '包名')
        ver = ver || formField(map, '版本（可留空）', '版本')
        reason = reason || rest
      }
    }
  } else if (e.event === 'issues' && (e.action === 'opened' || e.action === 'edited')) {
    // the parser is the command contract — the workflow's job-if narrows
    // issues events to [concern] titles today, but resolve must stay correct
    // if that gate ever widens (a [review] opened event would otherwise be
    // silently read as a form)
    if (!e.issueTitle.startsWith('[concern]')) return { skip: 'noresolve' }
    const map = sections(e.issueBody)
    name = formField(map, 'npm 包名或 owner/repo', '包名')
    ver = formField(map, '版本（可留空）', '版本')
    const act = formField(map, '操作 / Action', '操作')
    // word-boundary: 'compass'/'bypass'/'passable' contain 'pass' as a
    // substring — an ambiguous action must fall to concern (the form's
    // default), never silently upgrade to a release verdict
    verdict = /\bpass\b|放行/i.test(act) ? 'pass' : 'concern'
    reason = formField(map, '理由 / Reason', '理由')
  } else {
    return { skip: 'noresolve' }
  }

  // `pkg@*` = explicit PACKAGE scope (every version / the whole package) —
  // preserved through cleanVer so the workflow can write a version:null
  // verdict, which applyMatureVerdicts reads as a package-level brake.
  // Anything else version-ish still goes through the charset sanitizer.
  ver = ver === '*' ? '*' : cleanVer(ver)
  // name is maintainer-controlled text bound for $GITHUB_OUTPUT — a form
  // field or title carrying a newline would inject extra k=v lines (the
  // reason/ver/mismatch fields are already oneLine'd; name was the gap)
  name = oneLine(name)
  const repo = isRepoName(name)
  if (repo) ver = ''
  if (!name || !verdict) return { skip: 'noresolve' }
  const out: VerdictResolved = { name, ver, verdict, reason: oneLine(reason) }
  if (mismatch) out.mismatch = oneLine(mismatch)
  if (repo) out.isrepo = '1'
  return out
}

/** True when the LATEST line for vkey(name,version) is already a human verdict
 *  with identical verdict+reason. An edited-issue re-run is semantically a
 *  no-op — writing a fresh line would give a pass verdict a new `at`, hence a
 *  new akey ∉ digest-state.announced, restarting its maturity window for a
 *  typo fix (HV-2). Source matters: an AI verdict on top must NOT dedupe a
 *  human write — the human source itself is the R-4 stickiness signal. */
export function isDupVerdict(lines: string[], name: string, version: string | null, verdict: string, reason: string): boolean {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.trim()
    if (!l) continue
    try {
      const v = JSON.parse(l) as { name?: string; version?: string | null; verdict?: string; reason?: string; source?: string }
      if (v.name?.toLowerCase() !== name.toLowerCase() || (v.version ?? null) !== version) continue
      // normalize BOTH sides — a writer that stored a multi-line reason vs a
      // caller passing the raw comment text must still dedupe correctly
      return v.source === 'human' && v.verdict === verdict && oneLine(v.reason ?? '') === oneLine(reason)
    } catch { continue }
  }
  return false
}

/** Override detection (HV-12): the latest HUMAN line for this key carries a
 *  DIFFERENT verdict — this write reverses a human decision, not an AI one.
 *  That is a materially bigger deal: a [concern] form edit that re-fires a
 *  stale "拦截" can silently re-brake over a pass that landed in between, and
 *  the maintainer editing a typo never sees the flip. The workflow echoes
 *  the overridden decision in the ack so the reversal is at least visible.
 *  Returns the prior human {verdict, at} when the new verdict overrides it,
 *  else null (same verdict → dup/amend territory; no human line; AI on top —
 *  overriding the robot is the channel's routine purpose, not noteworthy). */
export function overriddenHuman(lines: string[], name: string, version: string | null, verdict: string): { verdict: string; at: string } | null {
  // newest HUMAN line for the key — an AI line on top doesn't change which
  // human decision is being reversed (stickiness already shadows it)
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.trim()
    if (!l) continue
    try {
      const v = JSON.parse(l) as { name?: string; version?: string | null; verdict?: string; source?: string; at?: string }
      if (v.source !== 'human' || v.name?.toLowerCase() !== name.toLowerCase() || (v.version ?? null) !== version) continue
      if (typeof v.verdict === 'string' && v.verdict !== verdict && typeof v.at === 'string')
        return { verdict: v.verdict, at: v.at }
      return null
    } catch { continue }
  }
  return null
}

/** Retarget detection (HV-13): the latest human line traced to THIS issue
 *  points at a DIFFERENT package. A [concern] form edit that changes the
 *  package field lands a verdict on the new target while the old target's
 *  verdict — possibly a live brake — keeps standing invisibly. Arg-spec
 *  comments that legitimately judged another package from the same issue
 *  produce the same signal; surfacing it is informative either way. */
export function retargetedIssueTarget(lines: string[], issue: number, name: string): { name: string; version: string | null } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.trim()
    if (!l) continue
    try {
      const v = JSON.parse(l) as { name?: string; version?: string | null; source?: string; issue?: number }
      if (v.source !== 'human' || v.issue !== issue || v.name?.toLowerCase() === name.toLowerCase()) continue
      return { name: v.name!, version: v.version ?? null }
    } catch { continue }
  }
  return null
}

/** Reason-only amendment (HV-2 counterpart): the latest human line for this
 *  key carries the SAME verdict but a DIFFERENT reason — a typo fix or a
 *  late "/concern pkg new reason". Appending with a fresh `at` would mint a
 *  new akey ∉ digest-state.announced and freeze an already-announced pass
 *  for another digest cycle. Reusing the prior line's `at` keeps the
 *  announcement key (and maturity) stable; the audit trail keeps BOTH lines.
 *  Returns the `at` to reuse, or null when no amend applies (caller writes
 *  a normal fresh timestamp). Only fires when the LATEST line for the key
 *  is the matching human verdict — an AI line or a verdict flip on top means
 *  this is a new decision, not an edit. */
export function amendAt(lines: string[], name: string, version: string | null, verdict: string, reason: string): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.trim()
    if (!l) continue
    try {
      const v = JSON.parse(l) as { name?: string; version?: string | null; verdict?: string; reason?: string; source?: string; at?: string }
      if (v.name?.toLowerCase() !== name.toLowerCase() || (v.version ?? null) !== version) continue
      if (v.source === 'human' && v.verdict === verdict && oneLine(v.reason ?? '') !== oneLine(reason)
          && typeof v.at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v.at))
        return v.at
      return null
    } catch { continue }
  }
  return null
}

/* v8 ignore next 24 — thin env→stdout adapter */
if (import.meta.url === `file://${process.argv[1]}`) {
  // dedupe mode: `human-verdict.ts dedupe <verdicts.jsonl> <name> <ver> <verdict> <reason> [issue]`
  // → prints dup=1|0 plus amend=<at>| (empty) — amend is the prior human
  // line's timestamp to reuse when this is a reason-only correction, so the
  // workflow can stamp the record without resetting digest maturity;
  // prev=<verdict>@<at> = the human decision this write overrides (HV-12);
  // previssue=<name>[@ver] = a stale verdict this issue left on another
  // target (HV-13 form retarget) — both feed ack warnings
  if (process.argv[2] === 'dedupe') {
    const { readFileSync } = await import('node:fs')
    const [, , , file, name, ver, verdict, reason, issue] = process.argv
    const lines = readFileSync(file!, 'utf8').split('\n')
    const ver_ = ver || null
    const dup = isDupVerdict(lines, name!, ver_, verdict!, reason ?? '')
    console.log(`dup=${dup ? 1 : 0}`)
    console.log(`amend=${dup ? '' : amendAt(lines, name!, ver_, verdict!, reason ?? '') ?? ''}`)
    // prev = the human decision this write would override (different verdict);
    // previssue = a stale verdict this issue left on a DIFFERENT target (form
    // retarget). Both feed ack warnings — nothing is silently reversed.
    const prev = dup ? null : overriddenHuman(lines, name!, ver_, verdict!)
    console.log(`prev=${prev ? `${prev.verdict}@${prev.at}` : ''}`)
    const re = issue ? retargetedIssueTarget(lines, Number(issue), name!) : null
    console.log(`previssue=${re ? `${re.name}${re.version ? `@${re.version}` : ''}` : ''}`)
    process.exit(0)
  }
  const p = process.env
  const r = resolveVerdictEvent({
    event: p.EVENT ?? '', action: p.ACTION ?? '',
    issueTitle: p.ISSUE_TITLE ?? '', issueBody: p.ISSUE_BODY ?? '',
    issueNumber: p.ISSUE_NUMBER ?? '', commentBody: p.COMMENT_BODY ?? '',
    label: p.LABEL ?? '', actor: p.ACTOR ?? '',
  })
  for (const [k, v] of Object.entries(r)) if (v !== undefined && v !== '') console.log(`${k}=${v}`)
  console.error(JSON.stringify(r))
}
