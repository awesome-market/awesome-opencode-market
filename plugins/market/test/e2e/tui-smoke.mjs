// TUI pty 冒烟 — node-pty + 抓屏。用法: node test/e2e/tui-smoke.mjs
import { spawn } from 'node-pty'
import { Terminal } from 'xterm-headless'

const term = new Terminal({ cols: 120, rows: 40 })
const t = pty.spawn('opencode', [], { cols: 120, rows: 40 })
t.onData(d => term.write(d))
const screen = () => {
  const b = term.buffer.active
  let s = ''
  for (let i = 0; i < b.length; i++) s += b.getLine(i)?.translateToString(true) + '\n'
  return s
}
const wait = (re, ms = 15_000) => new Promise((res) => {
  const iv = setInterval(() => { if (re.test(screen())) { clearInterval(iv); res(true) } }, 200)
  setTimeout(() => { clearInterval(iv); res(re.test(screen())) }, ms)
})
const results = []
const check = (name, ok) => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name}`) }

await wait(/opencode/i)
t.write('/market\r')
check('market dialog opens', await wait(/发现|插件/))
// ↑↑↑ 从卡片进 chrome（3322281 回归）
t.write('\x1b[A\x1b[A\x1b[A')
check('chrome focus reachable', await wait(/1 发现/))
t.write('q')
check('market closes on q', await wait(s => !/发现/.test(s)))
t.kill()
process.exit(results.every(Boolean) ? 0 : 1)
