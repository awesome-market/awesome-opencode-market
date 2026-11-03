# 发版前测试检查单

> 每次发版前照着跑一遍。全部绿才发。红了就按「失败排查」表处理，别带病发。

## 前置说明

- 在本机（macOS）跑，不在 CI。单测 CI 已自动跑，这里主要是真实端冒烟。
- `npm run e2e` **会强制关闭正在运行的 OpenCode 桌面端**再自启（调试模式）。跑之前手头 app 里有未保存的东西先处理。
- 全程约 2–4 分钟：桌面段 ~30 秒，TUI 段 ~2–3 分钟（真实装/卸/升级要走网络）。
- 桌面冒烟结束后 app 会留在「调试模式启动」状态（9222 端口开着）——正常用没问题。

## 步骤总览

```bash
cd /Volumes/2t/code/opencode-market

# 1. 类型 + 单测 + 覆盖率门禁
npm run check

# 2. 真实端冒烟（桌面 CDP + TUI pty）
npm run e2e

# 3. 确认工作区干净，提交推送
git status
git push
```

---

## Step 1 — `npm run check`

```bash
npm run check
```

### 期望输出

```
tsc --noEmit              # 无输出 = 通过

Test Files  N passed (N)
Tests       N passed (N)
Branches    >90%          # 低于 90% 直接 exit 1
```

### 失败排查

| 现象 | 原因 | 咋办 |
|---|---|---|
| `error TSxxxx` | 类型错 | 按报错位置修，别用 `// @ts-ignore` 压 |
| 单测红 | 行为回归 | 看红的用例名——`已固化的真实 bug 用例`表（regression-tests.md）能对上就是老坑回来了 |
| `unexpected pass` | `it.fails` 用例意外转绿 | 好事——说明之前留的红 case 被修好了，摘掉 `fails` 标记转正 |
| 分支 <90% | 新代码没测到 | `npm run coverage` 看哪层掉了，补 L2/L3 用例 |

---

## Step 2 — `npm run e2e`

```bash
npm run e2e        # 两段连跑
# 或单独跑：
npm run e2e:desktop
npm run e2e:tui
```

脚本自己管理进程：杀掉运行中的 OpenCode → 带调试端口自启 → 清陈旧 opencode 进程 → 跑检查。**不需要手工启动任何东西。**

### 桌面段期望输出（8 项全 ✓）

```
launching OpenCode with debug port…
✓ sidebar Market item exists (plugin alive)
✓ market panel open            （或 market panel opens on click）
✓ 更新数据 refreshes
✓ tab 我的插件 switches
✓ tab 技能 switches
✓ tab 发现 switches
✓ tab 插件 switches
✓ tab 设置 switches
```

### TUI 段期望输出（全 ✓）

```
✓ pre-pin @1930dev/opencode-usage@0.4.1
✓ opencode starts
✓ market dialog opens
✓ index renders (cards + categories)
✓ update path runs (updating status)
✓ tab 5 我的插件 shows installed
✓ tab 2 插件 shows catalog cards
✓ tab 7 设置 shows settings
✓ tab 1 back to 发现
✓ search filters to opencode-usage
✓ search no-match shows empty state
✓ esc in search stays in market
✓ enter opens detail dialog
✓ esc closes detail back to list
✓ favorite toggle marks card
✓ f opens filter overlay
✓ r triggers refresh
✓ mouse click selects a card
✓ wheel input does not crash market
✓ mouse click switches to 我的插件
✓ still in market after ↑↑↑
✓ update path runs
✓ q closes market to main TUI
✓ @1930dev/opencode-usage upgraded to 0.5.0
```

最后一项是**真实升级实锤**：钉版 0.4.1 → 市场内升级 → `plugin list` 确认 0.5.0。这条挂了说明装/升链路真坏了，不许发。

### 逐项失败排查

| 红项 | 可能原因 | 咋办 |
|---|---|---|
| `sidebar Market item exists` | 插件没加载 / app 侧栏渲染慢 | 手动开 app 看侧栏有没有 Market；查 `~/.local/share/opencode/log/` 插件加载错 |
| `market panel open` | 侧栏项点了没反应 | 大概率插件挂了——看 devlog（设置→开发日志） |
| `更新数据 refreshes` | daemon 冷加载超时（现在最多等 60s） | 单独重跑 `npm run e2e:desktop`；还挂就手动进设置点更新数据看状态行 |
| `tab XX switches` | 某 tab 渲染崩了 | 手动切到该 tab 看白屏/报错 |
| `pre-pin` | daemon 没起来或没扫到新 config | `opencode plugin list` 手动看输出；`opencode service start` 后重跑 |
| `opencode starts` / `market dialog opens` | TUI 起不来 / `/market` 没注册 | 手动跑 `opencode` 输 `/market` 看现象 |
| `update path runs` | 首卡不是 usage 钉版卡 | 索引变了首卡变了——检查 `plugin list` 里钉版在不在 |
| `search filters` | 索引里没有 usage 条目 | 该包被下架/索引重建丢了——换测试包改 `PKG` 常量 |
| `upgraded to 0.5.0` | 升级真失败 / plugin list 延迟 | 手动 `opencode plugin list` 看版本；config 里 spec 对不对 |
| 任何超时成片挂 | 网络问题（npm 拉不动） | 看网络再重跑 |

### 已知非阻塞项

- `wheel input does not crash market` 只断「不崩」不断「真滚了」——pty 里滚轮事件投递不稳，真滚动效果靠桌面段/人工确认。

### 跑完环境状态

- 桌面 app 被重启过，停在调试模式（9222 开着），可以正常用
- `@1930dev/opencode-usage` 恢复到 `0.5.0` 裸 spec（无钉版）
- 收藏/筛选等操作都在临时 TUI 会话里，不留痕迹

---

## Step 3 — 提交推送

```bash
git status          # 工作区应该是干净的（e2e 会碰 ~/.config 不动仓库）
git log --oneline -3
git push            # 或等你指令推
```

如需发 npm 包：`npm publish`（`prepublishOnly` 会自动 build，只发编译 JS）。
