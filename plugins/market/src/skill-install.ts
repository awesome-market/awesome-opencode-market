/** Shared skill install/uninstall — npm tarball bytes → skill source root.
 *  Used by the GUI main process (writeSkill IPC) and the TUI page directly.
 *  Layout follows opencode.ai/v2/docs/skills: hidden nests are invisible to
 *  discovery, and a dir holding SKILL.md masks deeper skills — so nested
 *  skills are lifted to the source root preserving author IDs, prefixed with
 *  the package basename only on foreign collision. A .market-skills.json
 *  manifest records lifted paths so uninstall removes exactly what we made. */
import { assertSkillId, skillId, skillsRoot } from './hostx.js'

/** A tar entry path must stay inside `dest`: reject absolute paths, `.`/`..`
 *  segments (incl. after ./ or package/ prefix stripping), and backslashes
 *  (path separator on Windows — a crafted `..\` name must not survive). */
export function safeTarRel(raw: string): string | null {
  const rel = raw.replace(/\\/g, '/').replace(/^(\.\/)?(package\/)?/, '')
  if (!rel || rel.startsWith('/') || rel.split('/').some(p => p === '..' || p === '.' || p === '')) return null
  return rel
}

/** Compressed ceiling — callers also gate on response size, but the tarball
 *  is untrusted bytes either way. 48MB matches the GUI fetch cap. */
export const MAX_SKILL_TGZ = 48 * 1024 * 1024
/** Decompressed ceiling — a 48MB gzip can expand 20x+; maxOutputLength makes
 *  zlib throw instead of OOMing the host process (zip-bomb guard). */
export const MAX_SKILL_TAR = 256 * 1024 * 1024

export async function installSkillTar(opts: { name: string; gzipped: Uint8Array; root: string }): Promise<string> {
  const { gunzipSync } = await import('node:zlib')
  const fs = await import('node:fs')
  const { join, dirname, resolve, sep } = await import('node:path')
  const { writeFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, existsSync } = fs
  if (opts.gzipped.byteLength > MAX_SKILL_TGZ) throw new Error(`skill tarball too large (${opts.gzipped.byteLength} bytes)`)
  const tar = gunzipSync(Buffer.from(opts.gzipped), { maxOutputLength: MAX_SKILL_TAR })
  const base = assertSkillId(opts.name)
  const ns = skillId(opts.name)
  const manifestOwner = (dir: string): string | undefined => {
    try { return (JSON.parse(readFileSync(join(dir, '.market-skills.json'), 'utf8')) as { name?: string }).name } catch { return undefined }
  }
  // Default: install at the bare basename. A namespaced dir wins on reinstall;
  // a basename dir owned by a DIFFERENT package namespaces both sides.
  let id = base
  const destBase = join(opts.root, base)
  if (ns !== base && existsSync(join(opts.root, ns)) && manifestOwner(join(opts.root, ns)) === opts.name) id = ns
  else if (ns !== base && existsSync(destBase)) {
    const owner = manifestOwner(destBase)
    if (owner !== opts.name) {
      if (owner) {
        const renamed = join(opts.root, skillId(owner))
        if (!existsSync(renamed)) renameSync(destBase, renamed)
      }
      id = ns
    }
  }
  const dest = join(opts.root, id)
  if (!resolve(dest).startsWith(resolve(opts.root) + sep)) throw new Error(`dest escapes skills root: ${dest}`)
  // A dir we didn't create (or one created under another package's ownership)
  // is foreign. Unscoped names have no namespaced fallback at all, and even
  // scoped ones never merge into a foreign dir at the namespaced path — refuse
  // rather than drop a manifest into it (uninstall would delete user files).
  if (existsSync(dest) && manifestOwner(dest) !== opts.name)
    throw new Error(`skill dir '${id}' already exists and is not managed by market — refusing to overwrite`)
  mkdirSync(dest, { recursive: true })
  let off = 0, wrote = 0
  // GNU longname ('L') / pax 'x' carry the REAL name for the NEXT header;
  // ustar stores paths ≤255B as prefix(155B @345) + '/' + name(100B @0).
  let pendingLong: string | null = null
  const paxPath = (rec: string): string | null => {
    let i = 0
    while (i < rec.length) {
      const sp = rec.indexOf(' ', i)
      if (sp < 0) return null
      const len = parseInt(rec.slice(i, sp), 10)
      if (!len || i + len > rec.length) return null
      const kv = rec.slice(sp + 1, i + len - 1)
      const eq = kv.indexOf('=')
      if (eq > 0 && kv.slice(0, eq) === 'path') return kv.slice(eq + 1)
      i += len
    }
    return null
  }
  // pass 1 — collect safe entries. Two passes let us detect a wrapper root:
  // github codeload archives ship every path under `<repo>-<ref>/`, which must
  // be stripped like npm's `package/` or the skill nests stay one level deep.
  const items: { type: string; rel: string; body: number; size: number }[] = []
  while (off + 512 <= tar.length) {
    let f = tar.toString('utf8', off, off + 100).replace(/\0[\s\S]*$/, '')
    if (!f) break
    const prefix = tar.toString('utf8', off + 345, off + 500).replace(/\0[\s\S]*$/, '')
    const size = parseInt(tar.toString('utf8', off + 124, off + 136).trim(), 8) || 0
    const type = tar.toString('utf8', off + 156, off + 157)
    const body = off + 512
    const next = body + Math.ceil(size / 512) * 512
    if (type === 'L') { pendingLong = tar.toString('utf8', body, body + size).replace(/\0[\s\S]*$/, ''); off = next; continue }
    if (type === 'x') { pendingLong = paxPath(tar.toString('utf8', body, body + size)) ?? pendingLong; off = next; continue }
    if (pendingLong) { f = pendingLong; pendingLong = null }
    else if (prefix) f = `${prefix}/${f}`
    const rel = safeTarRel(f)
    if (rel === null || rel.split('/').pop()!.startsWith('._')) { off = next; continue }  // unsafe name or macOS AppleDouble junk
    items.push({ type, rel, body, size })
    off = next
  }
  // shared leading segment that is not a real skill-nest name = archive wrapper
  const STRUCT = new Set(['.opencode', '.claude', '.agents', 'skills', 'package'])
  const first = items[0]?.rel.split('/')[0]
  const wrap = first && !STRUCT.has(first) && items.every(i => { const s = i.rel.split('/'); return s.length > 1 && s[0] === first })
    ? `${first}/` : ''
  // pass 2 — extract
  for (const { type, rel: r0, body, size } of items) {
    const rel = wrap ? r0.slice(wrap.length) : r0
    if (!rel) continue
    if (type === '5') mkdirSync(join(dest, rel), { recursive: true })
    if (type === '0' || type === '' || type === ' ') {
      const fp = join(dest, rel)
      if (!resolve(fp).startsWith(resolve(dest) + sep)) continue
      mkdirSync(dirname(fp), { recursive: true })
      writeFileSync(fp, tar.subarray(body, body + size)); wrote++
    }
  }
  if (!wrote) throw new Error('empty tarball')
  const root = dirname(dest)
  // paths we created on a previous install may be overwritten in place;
  // a foreign dir at the same name forces the <id>- prefix instead
  const owned = new Set<string>()
  try {
    const prev = JSON.parse(readFileSync(join(dest, '.market-skills.json'), 'utf8')) as { paths?: string[] }
    for (const rel of prev.paths ?? []) owned.add(rel)
  } catch { /* first install */ }
  const nests = ['.opencode/skills', '.claude/skills', '.agents/skills',
    ...(existsSync(join(dest, 'SKILL.md')) ? ['skills'] : [])]
  const paths: string[] = []
  for (const nest of nests) {
    const nd = join(dest, nest)
    let subs: string[]
    try { subs = readdirSync(nd) } catch { continue }
    for (const sub of subs) {
      if (sub.startsWith('.') || sub === '..' || sub.includes('/') || sub.includes('\\')) continue
      // collision → try <id>-<sub>, then <id>-<sub>-2, … — but NEVER rmSync a
      // path we don't own (a foreign dir that happens to match the prefixed
      // name would otherwise be deleted). Give up on that skill instead.
      let rel = sub
      for (let n = 0; n < 100 && existsSync(join(root, rel)) && !owned.has(rel); n++)
        rel = `${id}-${sub}${n ? `-${n}` : ''}`
      if (existsSync(join(root, rel)) && !owned.has(rel)) continue
      const target = join(root, rel)
      if (!resolve(target).startsWith(resolve(root) + sep)) continue
      rmSync(target, { recursive: true, force: true })
      renameSync(join(nd, sub), target); paths.push(rel)
    }
    // only remove the emptied nest — a sub that couldn't be lifted (all 100
    // prefixed name variants collided) must survive, not be silently deleted
    try { if (!readdirSync(nd).length) rmSync(nd, { recursive: true, force: true }) } catch { /* leave */ }
  }
  writeFileSync(join(dest, '.market-skills.json'), JSON.stringify({ name: opts.name, paths }))
  return `wrote ${wrote}, lifted ${paths.length}`
}

export async function uninstallSkillDir(name: string, root: string): Promise<string> {
  const fs = await import('node:fs')
  const { join, resolve, sep } = await import('node:path')
  const { readdirSync, readFileSync, rmSync, existsSync } = fs
  const rootRes = resolve(root)
  assertSkillId(name)
  // conditional ids: a same-basename package lives at the namespaced dir —
  // check it first so a foreign basename dir is never touched; singletons
  // live at the bare basename
  let dest = resolve(root, skillId(name))
  if (!dest.startsWith(rootRes + sep)) throw new Error(`dest escapes skills root: ${dest}`)
  if (!existsSync(dest)) {
    const bare = resolve(root, name.split('/').pop()!)
    if (bare.startsWith(rootRes + sep) && existsSync(bare)) dest = bare
  }
  const mf = join(dest, '.market-skills.json')
  if (existsSync(mf)) {
    // manifest of lifted paths — remove exactly what installSkillTar created
    const m = JSON.parse(readFileSync(mf, 'utf8')) as { paths?: string[] }
    for (const rel of m.paths ?? []) {
      const t = resolve(rootRes, rel)
      if (t.startsWith(rootRes + sep)) rmSync(t, { recursive: true, force: true })
    }
  } else for (const d of readdirSync(rootRes)) {
    // collision-prefixed lifts were named <installId>-* — same as basename(dest)
    const destId = dest.slice(rootRes.length + 1)
    if (d.startsWith(`${destId}-`)) rmSync(join(rootRes, d), { recursive: true, force: true })
  }
  rmSync(dest, { recursive: true, force: true })
  return 'removed'
}

export async function globalSkillsRoot(): Promise<string> {
  return skillsRoot()
}
