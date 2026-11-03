// 桌面端真实冒烟 — 前置: OpenCode.app 带 --remote-debugging-port=9222 启动 + service 在跑
// 用法: node test/e2e/desktop-smoke.mjs
import { chromium } from 'playwright-core'
import { spawn, execSync } from 'node:child_process'

const APP = '/Applications/OpenCode.app/Contents/MacOS/OpenCode'
const FLAG = '--remote-debugging-port=9222'

async function connect() {
  return chromium.connectOverCDP('http://127.0.0.1:9222', { noDefaults: true })
}

let cdp = await connect().catch(() => null)
if (!cdp) {
  // no debug instance — if the app isn't running at all, launch it ourselves
  const running = process.platform === 'darwin'
    && execSync('pgrep -x OpenCode || true').toString().trim() !== ''
  if (running) {
    console.error(`✗ OpenCode 已在运行但不是调试模式 — 脚本不能接管你的实例`)
    console.error(`  咋办: 退出 Dock 里的 OpenCode 后重跑本脚本（脚本会自己以调试模式拉起）`)
    process.exit(2)
  }
  console.log('OpenCode not running — launching with debug port…')
  spawn(APP, [FLAG], { detached: true, stdio: 'ignore' }).unref()
  for (let i = 0; i < 20 && !cdp; i++) {
    await new Promise(r => setTimeout(r, 1500))
    cdp = await connect().catch(() => null)
  }
}
if (!cdp) {
  console.error(`✗ 连不上 CDP 端口 9222 — 自动拉起也失败了`)
  console.error(`  咋办: 手动跑 ${APP} ${FLAG} 看启动报错`)
  process.exit(2)
}
const results = []
const t = (name, ok) => { results.push([name, ok]); console.log(`${ok ? '✓' : '✗'} ${name}`) }

// poll — fresh launch needs time for renderer + sidebar to mount
let page = null, opened = false
const deadline = Date.now() + 45_000
while (Date.now() < deadline && !page) {
  for (const p of cdp.contexts()[0].pages()) {
    if (await p.locator('text=opencode market').first().isVisible({ timeout: 1500 }).catch(() => false)) { page = p; opened = true; break }
    if (await p.locator('text=Market').first().isVisible({ timeout: 1500 }).catch(() => false)) { page = p; break }
  }
  if (!page) await new Promise(r => setTimeout(r, 2000))
}
if (opened) {
  t('sidebar Market item exists (plugin alive)', true)
  t('market panel open', true)
} else {
  if (!page) { t('sidebar Market item exists (plugin alive)', false); await cdp.close(); process.exit(1) }
  t('sidebar Market item exists (plugin alive)', true)
  // REAL click — the app sidebar is host UI, dispatchEvent is synthetic and
  // invisible to Electron; the webview quirk only applies to the plugin webview
  const menuItem = page.locator('button').filter({ hasText: /^Market$/ }).first()
  await menuItem.click()
  opened = await page.locator('text=opencode market').first()
    .waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)
  t('market panel opens on click', opened)
  if (!opened) {
    console.log('clicked element:', await menuItem.evaluate(el => `${el.tagName}.${el.className}`).catch(() => '?'))
    await cdp.close(); process.exit(1)
  }
}

try {

  // 设置 → 更新数据 刷新（给它落点时间再点）
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.waitForTimeout(1200)
  const refBtn = page.getByRole('button', { name: /更新数据/ })
  // retry — listener may not be bound on first dispatch; cold daemon makes refresh slow.
  // waitFor actually polls; isVisible({timeout}) returns instantly (known trap)
  let refreshed = false
  for (let attempt = 0; attempt < 3 && !refreshed; attempt++) {
    await refBtn.dispatchEvent('mousedown').catch(() => {})
    refreshed = await page.locator('text=已刷新').first()
      .waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false)
  }
  t('更新数据 refreshes', refreshed)

  // tab switching — every market tab renders its own content
  for (const [tabName, marker] of [
    ['我的插件', '已安装|installed|未收录'],
    ['技能', '技能|skill|目录'],
    ['发现', '全部|分类|插件'],
    ['插件', '@'],
    ['设置', '更新数据|开发日志'],
  ]) {
    await page.getByRole('button', { name: tabName, exact: true }).click()
    const ok = await page.locator(`text=${marker.split('|')[0]}`).first()
      .waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)
    t(`tab ${tabName} switches`, ok)
  }
} catch (e) { t('smoke aborted', false); console.log(String(e).slice(0, 200)) }

await cdp.close()
process.exit(results.every(([, ok]) => ok) ? 0 : 1)
