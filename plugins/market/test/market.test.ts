import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { fetchIndex, DEFAULT_INDEX_URL } from '../src/catalog.ts'
import { rows } from '../src/gui.tsx'
import type { MarketEntry } from '../src/catalog.ts'

const dir = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(dir, '../package.json'), 'utf8'))

const mkEntry = (name: string, status: string, red = 0): MarketEntry => ({
  name, slug: name, type: 'plugin',
  capabilities: { scannedAt: 't', findings: [], redFlags: Array(red).fill('x') },
  verification: { status },
})

describe('market plugin', () => {
  it('exports map satisfies the host entry contract', () => {
    expect(pkg.exports['.']).toBe('./dist/server.js')
    expect(pkg.exports['./tui']).toBe('./dist/tui.js')
    expect(pkg.exports['./gui-experimental']).toBe('./dist/gui.cjs')
  })
  it('gui bundle exists and is CommonJS-evaluable text', () => {
    const p = join(dir, '../dist/gui.cjs')
    if (!existsSync(p)) {
      execFileSync('npx', ['tsx', 'build.ts'], { cwd: join(dir, '..') })
    }
    const code = readFileSync(join(dir, '../dist/gui.cjs'), 'utf8')
    expect(code).toContain('opencode-market')
    // CJS marker: module.exports or exports usage — ESM `export` statements must not appear top-level
    expect(code).not.toMatch(/^export\s+(default|\{)/m)
  })
  it('fetchIndex parses index shape', async () => {
    const idx = await fetchIndex().catch(() => null) // network optional in tests
    if (idx) expect(idx.plugins).toBeInstanceOf(Array)
    expect(DEFAULT_INDEX_URL).toContain('index.json')
  })
  it('rows: verified first, redFlag last, name order within', () => {
    const r = rows([
      mkEntry('b-unver', 'unverified'),
      mkEntry('a-ver', 'verified'),
      mkEntry('c-flag', 'skipped', 1),
    ])
    expect(r.map(e => e.name)).toEqual(['a-ver', 'b-unver', 'c-flag'])
  })
})
