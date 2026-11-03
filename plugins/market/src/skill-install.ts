/** Shared skill install/uninstall — npm tarball bytes → skill source root.
 *  Used by the GUI main process (writeSkill IPC) and the TUI page directly.
 *  Layout follows opencode.ai/v2/docs/skills: hidden nests are invisible to
 *  discovery, and a dir holding SKILL.md masks deeper skills — so nested
 *  skills are lifted to the source root preserving author IDs, prefixed with
 *  the package basename only on foreign collision. A .market-skills.json
 *  manifest records lifted paths so uninstall removes exactly what we made. */

export async function installSkillTar(opts: { name: string; gzipped: Uint8Array; root: string }): Promise<string> {
  const { gunzipSync } = await import('node:zlib')
  const fs = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { writeFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, existsSync } = fs
  const tar = gunzipSync(Buffer.from(opts.gzipped))
  const id = opts.name.split('/').pop()!
  const dest = join(opts.root, id)
  mkdirSync(dest, { recursive: true })
  let off = 0, wrote = 0
  while (off + 512 <= tar.length) {
    const f = tar.toString('utf8', off, off + 100).replace(/\0[\s\S]*$/, '')
    if (!f) break
    const size = parseInt(tar.toString('utf8', off + 124, off + 136).trim(), 8) || 0
    const type = tar.toString('utf8', off + 156, off + 157)
    const body = off + 512
    const rel = f.replace(/^(\.\/)?(package\/)?/, '')
    if (rel.split('/').pop()!.startsWith('._')) { off = body + Math.ceil(size / 512) * 512; continue }  // macOS AppleDouble junk
    if (rel && type === '5') mkdirSync(join(dest, rel), { recursive: true })
    if (rel && (type === '0' || type === '' || type === ' ')) {
      const fp = join(dest, rel); mkdirSync(dirname(fp), { recursive: true })
      writeFileSync(fp, tar.subarray(body, body + size)); wrote++
    }
    off = body + Math.ceil(size / 512) * 512
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
      if (sub.startsWith('.')) continue
      let rel = sub
      if (existsSync(join(root, rel)) && !owned.has(rel)) rel = `${id}-${sub}`
      rmSync(join(root, rel), { recursive: true, force: true })
      renameSync(join(nd, sub), join(root, rel)); paths.push(rel)
    }
    rmSync(nd, { recursive: true, force: true })
  }
  writeFileSync(join(dest, '.market-skills.json'), JSON.stringify({ paths }))
  return `wrote ${wrote}, lifted ${paths.length}`
}

export async function uninstallSkillDir(name: string, root: string): Promise<string> {
  const fs = await import('node:fs')
  const { join } = await import('node:path')
  const { readdirSync, readFileSync, rmSync, existsSync } = fs
  const id = name.split('/').pop()!
  const dest = join(root, id)
  const mf = join(dest, '.market-skills.json')
  if (existsSync(mf)) {
    // manifest of lifted paths — remove exactly what installSkillTar created
    const m = JSON.parse(readFileSync(mf, 'utf8')) as { paths?: string[] }
    for (const rel of m.paths ?? []) {
      const t = join(root, rel)
      if (t.startsWith(`${root}/`)) rmSync(t, { recursive: true, force: true })
    }
  } else for (const d of readdirSync(root)) {
    // legacy layout: lifted dirs were named <id>-*
    if (d.startsWith(`${id}-`)) rmSync(join(root, d), { recursive: true, force: true })
  }
  rmSync(dest, { recursive: true, force: true })
  return 'removed'
}

export async function globalSkillsRoot(): Promise<string> {
  const { homedir } = await import('node:os')
  const { join } = await import('node:path')
  return join(homedir(), '.config', 'opencode', 'skills')
}
