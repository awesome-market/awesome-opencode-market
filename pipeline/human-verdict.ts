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
}

/** `[review] name[@ver]` — scoped names keep their leading '@' (the last '@'
 *  is the version separator; a leading one at index 0 is not). `[concern]`
 *  titles carry free text, not a spec — never parse them as targets. */
export function titleTarget(t: string): { name: string; ver: string } | null {
  const m = t.match(/^\[review\]\s+(.+)$/)
  if (!m) return null
  return splitSpec(m[1]!.trim())
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
 *  value would corrupt the k=v $GITHUB_OUTPUT protocol, H-7). */
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 2000)

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
    verdict = e.label === 'verdict:pass' ? 'pass' : 'concern'
    reason = `via label ${e.label} by ${e.actor} (issue #${e.issueNumber})`
  } else if (e.event === 'issue_comment') {
    const m = e.commentBody.match(/^\/(concern|approve)(?:\s+([\s\S]*))?$/)
    if (!m) return { skip: 'noresolve' }
    verdict = m[1] === 'approve' ? 'pass' : 'concern'
    const rest = (m[2] ?? '').trim()
    if (rest && !rest.startsWith('#')) {
      const sp = rest.split(/\s+/)
      const t = splitSpec(sp[0]!)
      const tt = titleTarget(e.issueTitle)
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
        // a divergence worth flagging
        name = t.name; ver = cleanVer(t.ver); reason = sp.slice(1).join(' ')
        // arg-spec on a titled issue that points somewhere else: land the
        // verdict on the ARG (explicit intent), but flag it so the workflow
        // doesn't close the wrong review issue (H-4)
        if (specShape && tt && (tt.name !== name || (tt.ver !== '' && ver !== '' && tt.ver !== ver)))
          mismatch = `评论参数指向 ${name}${ver ? `@${ver}` : ''}，但本单目标是 ${tt.name}${tt.ver ? `@${tt.ver}` : ''}`
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
    const map = sections(e.issueBody)
    name = formField(map, 'npm 包名或 owner/repo', '包名')
    ver = formField(map, '版本（可留空）', '版本')
    const act = formField(map, '操作 / Action', '操作')
    verdict = /pass|放行/.test(act) ? 'pass' : 'concern'
    reason = formField(map, '理由 / Reason', '理由')
  } else {
    return { skip: 'noresolve' }
  }

  ver = cleanVer(ver)
  if (isRepoName(name)) ver = ''
  if (!name || !verdict) return { skip: 'noresolve' }
  const out: VerdictResolved = { name, ver, verdict, reason: oneLine(reason) }
  if (mismatch) out.mismatch = oneLine(mismatch)
  return out
}

/* v8 ignore next 8 — thin env→stdout adapter */
if (import.meta.url === `file://${process.argv[1]}`) {
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
