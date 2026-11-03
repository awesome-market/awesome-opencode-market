// 桌面端真实冒烟 — 前置: OpenCode.app 带 --remote-debugging-port=9222 启动 + service 在跑
// 用法: node test/e2e/desktop-smoke.mjs
import { chromium } from 'playwright-core'

const cdp = await chromium.connectOverCDP('http://127.0.0.1:9222', { noDefaults: true })
const page = cdp.contexts()[0].pages()[0]
const results = []
const t = (name, ok) => { results.push([name, ok]); console.log(`${ok ? '✓' : '✗'} ${name}`) }

try {
  // 假设市场已在某个 window 打开；没有就提示
  const market = page.locator('text=opencode market').first()
  await market.waitFor({ timeout: 10_000 })
  t('market opens', true)

  // 设置 → 更新数据 刷新
  await page.locator('button', { hasText: '设置' }).first().click()
  await page.locator('button', { hasText: '更新数据' }).first().dispatchEvent('mousedown')
  const refreshed = await page.locator('text=已刷新').first().isVisible({ timeout: 15_000 }).catch(() => false)
  t('更新数据 refreshes', refreshed)

  // 我的插件 有卡
  await page.locator('button', { hasText: '我的插件' }).first().click()
  const cards = await page.locator('text=已安装').count()
  t('我的插件 has installed cards', cards > 0)
} catch (e) { t('smoke aborted', false); console.log(String(e).slice(0, 200)) }

await cdp.close()
process.exit(results.every(([, ok]) => ok) ? 0 : 1)
