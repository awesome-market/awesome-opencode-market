// 桌面端真实冒烟 — 前置: OpenCode.app 带 --remote-debugging-port=9222 启动 + service 在跑
// 用法: node test/e2e/desktop-smoke.mjs
import { chromium } from 'playwright-core'

const cdp = await chromium.connectOverCDP('http://127.0.0.1:9222', { noDefaults: true })
const results = []
const t = (name, ok) => { results.push([name, ok]); console.log(`${ok ? '✓' : '✗'} ${name}`) }

const pages = cdp.contexts()[0].pages()
// already-open market counts as pass — plugin alive + panel open
let page = null, opened = false
for (const p of pages) {
  if (await p.locator('text=opencode market').first().isVisible({ timeout: 2500 }).catch(() => false)) { page = p; opened = true; break }
}
if (opened) {
  t('sidebar Market item exists (plugin alive)', true)
  t('market panel open', true)
} else {
  for (const p of pages) {
    const found = await p.locator('text=Market').first().isVisible({ timeout: 2500 }).catch(() => false)
    if (found) { page = p; break }
  }
  if (!page) { t('sidebar Market item exists (plugin alive)', false); await cdp.close(); process.exit(1) }
  t('sidebar Market item exists (plugin alive)', true)
  // REAL click — the app sidebar is host UI, dispatchEvent is synthetic and
  // invisible to Electron; the webview quirk only applies to the plugin webview
  const menuItem = page.locator('button').filter({ hasText: /^Market$/ }).first()
  await menuItem.click()
  await page.waitForTimeout(500)
  opened = await page.locator('text=opencode market').first().isVisible({ timeout: 10_000 }).catch(() => false)
  t('market panel opens on click', opened)
  if (!opened) {
    console.log('clicked element:', await menuItem.evaluate(el => `${el.tagName}.${el.className}`).catch(() => '?'))
    await cdp.close(); process.exit(1)
  }
}

try {

  // 设置 → 更新数据 刷新
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: /更新数据/ }).click()
  const refreshed = await page.locator('text=已刷新').first().isVisible({ timeout: 15_000 }).catch(() => false)
  t('更新数据 refreshes', refreshed)

  // 我的插件 有卡
  await page.getByRole('button', { name: '我的插件', exact: true }).click()
  const cards = await page.locator('text=已安装').count()
  t('我的插件 has installed cards', cards > 0)
} catch (e) { t('smoke aborted', false); console.log(String(e).slice(0, 200)) }

await cdp.close()
process.exit(results.every(([, ok]) => ok) ? 0 : 1)
