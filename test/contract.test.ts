import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../plugins/market/src/gui.ts', import.meta.url), 'utf8')

// indentation-based key extraction — method keys sit at a fixed indent
function keysIn(startMark: string, indent: number): string[] {
  const lines = src.slice(src.indexOf(startMark)).split('\n')
  const out: string[] = []
  const re = new RegExp(`^\\s{${indent}}(\\w+)\\s*:`)
  for (const ln of lines.slice(1)) {
    const m = ln.match(re)
    if (m) out.push(m[1])
    else if (ln.trim() && !ln.startsWith(' '.repeat(indent))) break
  }
  return out
}

describe('IPC contract: schema ⇄ provide ⇄ Api', () => {
  const methods = keysIn('methods: {', 4)
  const provided = keysIn('m.provide(Market, {', 8)
  const api = [...src.matchAll(/^  (\w+)\??\(([^)]*)\)/gm)].filter(m => src.indexOf(m[0]) < src.indexOf('const Market')).map(m => m[1])

  it('every methods-schema key is provided', () => {
    expect(methods.sort()).toEqual(provided.sort())
  })
  it('every Api interface method exists in schema', () => {
    for (const m of api) expect(methods).toContain(m)
  })
  it('window-side safe.* calls resolve to schema methods', () => {
    const used = [...src.matchAll(/safe\.(\w+)\b/g)].map(m => m[1]).filter(k => k !== 'on')  // safe.on is the event channel, not an IPC method
    for (const u of new Set(used)) expect(methods).toContain(u)
  })
})
