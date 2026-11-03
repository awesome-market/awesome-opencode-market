# 回归测试说明

> 怎么用、覆盖什么、怎么加新用例。设计图见 `docs/regression-test-plan.md`。

## 快速开始

```bash
cd /Volumes/2t/code/opencode-market

npm test                    # 全部单测（CI 同款）
npm run coverage            # + 覆盖率，分支 ≥90% 卡门
npm run check               # typecheck + coverage，发版前跑

# 单独跑
npx vitest run test/spec.test.ts       # L2 纯函数
npx vitest run test/contract.test.ts   # L1 IPC 契约
npx vitest run test/gui-mount.test.ts  # L3 jsdom 挂载
npx vitest run --coverage              # 看哪层掉出 90%

# 发版前真实端冒烟（需要本机环境）
# 桌面端：先用调试端口启动 app（正常 Dock 启动的实例没有 CDP 端口，需 Cmd+Q 退出后重启）
open -a "OpenCode" --args --remote-debugging-port=9222
# 或直接跑二进制：
/Applications/OpenCode.app/Contents/MacOS/OpenCode --remote-debugging-port=9222
curl http://127.0.0.1:9222/json/version   # 有 JSON 返回 = CDP 通了

node plugins/market/test/e2e/desktop-smoke.mjs   # 桌面 CDP
python3 plugins/market/test/e2e/tui-smoke.py     # TUI pty（Python 自带 pty 模块，零依赖；node-pty 本机原生绑定坏、script 需要真 stdin tty）
```

CI：`ci.yml` 每次 push 自动跑 `tsc --noEmit` + `vitest --coverage`。

## 测试分层

| 层 | 文件 | 覆盖 | 防什么 |
|---|---|---|---|
| **L1 契约** | `test/contract.test.ts` | IPC methods schema ⇄ `m.provide` ⇄ Api 接口三方对齐 + `safe.*` 用法审计 | `safe.X is not a function`、方法漏注册 |
| **L2 纯函数** | `test/spec.test.ts`、`test/features.test.ts` 等 | `spec.ts`、`catalog.ts`、`pipeline/`、`src/categories.ts` | spec 解析、去重、卸载匹配、features 双 key、分类规则 |
| **L3 挂载** | `test/gui-mount.test.ts` | jsdom 挂载真实 `setup()`，spy fake `safe` api | 按钮不触发、状态回弹、占位符没实现 |
| **L4 冒烟** | `plugins/market/test/e2e/desktop-smoke.mjs` + `tui-smoke.py` | CDP 桌面 / pty TUI | webview 事件怪癖、真实 daemon 时序 |

## 已固化的真实 bug 用例

| bug | 用例位置 |
|---|---|
| `safe.update` 没注册 IPC schema | contract.test.ts `every methods-schema key is provided` |
| scoped 名被 `/@\d/` 剥成空串 | spec.test.ts `cleanSpec` |
| 钉版 spec duplicate / 卸载匹配错 | spec.test.ts `dedupeSpecs`/`removeSpec` |
| features 按 spec 存按 id 查不到 | spec.test.ts `featuresMap` 双 key |
| `全部更新` 占位符没实现 | gui-mount.test.ts `api.update never called`（red case） |

## 怎么加新用例

### 修一个 bug → 先写失败用例

1. **纯逻辑** → 提函数到 `spec.ts`/`catalog.ts`，在 `test/spec.test.ts` 加 describe（注入假数据，不碰 fs/网络）
2. **IPC 不对称** → contract.test.ts 已经自动扫——新加 methods schema 没 provide 就红
3. **按钮/状态** → `test/gui-mount.test.ts`：

```ts
it('XXX', async () => {
  const { root, api } = mount({ installed: vi.fn(async () => staleInventory) })
  await flush()
  const btn = [...root.querySelectorAll('button')].find(b => b.textContent === 'XXX')!
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))  // 用 mousedown 不是 click
  await flush()
  expect(api.xxx).toHaveBeenCalled()              // 断行为
  expect(root.textContent).toContain('YYY')        // 断状态
})
```

4. **真实环境怪癖** → 加进 `test/e2e/*.mjs`，发版前手动跑

### 断行为不断存在性

`expect(api.update).toHaveBeenCalled()` —— 别只断"按钮存在"。占位符/假实现会骗过存在性断言。

### 宿主依赖 mock

`@opencode/plugin/gui` 在 jsdom 下不解析——`vitest.config.ts` 已 alias 到 `test/helpers/host-stub.ts`；`solid-js/web` 已 alias 到 client build。新宿主 API 用了就补 stub。

## 红线

- `npm test` 必须全绿才 commit（`it.fails` 标记 WIP 不卡门）
- `npm run coverage` 分支 ≥90%
- L1-L3 进 `npm test`；L4 不进 CI（要真环境）
- 新功能合并时带对应 L2/L3 用例，不后补
