# 卡点验证状态（随 spike 推进更新）

## Spike #1（run 41347141082）关键发现

**装错了版本**：`bun install -g opencode-ai` 装到的是 **v1.19.5**（旧 CLI），不是 v2.2.5。
v1 的 `plugin` 命令语义不同：`opencode plugin <module>` 把参数当包名装——
我们的 `plugin list` 实际装了一个叫 "list" 的 npm 包（日志可见 "Added to ./.opencode/opencode.json"）。
**v2 CLI 是 `@opencode/cli` 包**（amplifying.ai 文档佐证：v1=opencode-ai，v2=@opencode/cli）。

附带发现：v1 `plugin add` 默认写到**项目级** `.opencode/opencode.json`，`-g` 才写全局——
这对隔离装测是好事：装测可以完全关在临时目录里，不碰真实 HOME。

| # | 卡点 | 状态 | 证据 |
|---|---|---|---|
| A1 | 无头启动需 provider/auth | 🟡 | v1 plugin add 无 server 也能写 config；server 启动验证待 v2 重测 |
| A2 | plugin add 在 CI 行为 | 🟡 | 非交互可用；file:// 未验（v1 只认 npm/Git specifier，v2 待测） |
| A3 | canary 激活信号 | ⬜ | v1 无 `plugin list` 子命令；待 v2 重测 |
| A4 | SDK 包名 | ✅ | `@opencode/plugin`（loop-recover peerDep 实证） |
| A5 | bun postinstall | ⬜ | 待 v2 沙箱测 |
| **新 A6** | **CI 装对 v2 二进制** | 🔴→需修 | `opencode-ai`=v1；v2 需 `@opencode/cli` 或官方安装脚本 |

下一步：改用 v2 安装方式重跑 spike。

## Spike #3 发现
- 官方安装脚本 `opencode.ai/install` 默认也装 **v1.19.5**——v2 是独立轨道
- 下一步试 `npm i -g @opencode/cli`（npm 默认放行 postinstall，bun 才拦）

## Spike #4（run 41347715406）——P0 基本判定通过

✅ **A1**：`plugin add` 无 provider/auth 也能跑（v2 装好即用）
✅ **A2**：`plugin add` 非交互可用；但 **file:// 不支持**——"must be an npm registry package or Git specifier"。负样本改用假 npm 名或 git 源
✅ **A4**：`@opencode/plugin` 确认
✅ **A5**：bun 默认拦 postinstall（`@opencode/cli` 在 bun 下装失败实证）——npm i -g 才放行
✅ **A6（新增）**：v2 正确装法 = `npm i -g @opencode/cli`（v2.2.5）；官方 install 脚本和 `bun i -g opencode-ai` 都装 v1.19.5

🟡 **残留**：
- `plugin list` 报 "No plugins found" 但 add 明明成功——add 写到 `~/.config/opencode/opencode.json`，说明隔离要用 `XDG_CONFIG_HOME` 不是 `HOME`（下一轮验证）
- 真激活信号：add 只写 config+装包，"插件是否真被加载"还需 server 启动观测——canary 路径 b/c 待验
- file:// 不支持 → 负样本 fixture 策略改：用不存在的 npm 名 / git specifier 或本地起 registry stub

**P0 初步结论：可行**——v2 在 CI 能装、能 add 插件、无需凭据；剩余是信号细节不是可行性问题。

## Spike #5（run 41348320405）——A3 最终判定

✅ **XDG_CONFIG_HOME 隔离确认**：add 写 `/tmp/spikehome/.config/opencode/opencode.json`，`plugin` 数组含包名——隔离装测的正确姿势
✅ **负样本信号**：假 npm 名 → `NpmInstallFailedError` + 404 cause，文本可断言
❌ **plugin list ≠ canary**：config 里明明有插件，`plugin list` 仍报 "No plugins found"——它读的不是全局 config（可能只读项目级/已加载集合），不能当激活信号
❌ **serve 日志无插件行**：`opencode serve --print-logs` 30s 无任何 plugin/loop-recover 日志行——插件加载不在 server 启动路径上（可能在 session 懒加载，或需 --standalone）

**A3 最终结论**：主机侧**没有现成的"插件已激活"可观测信号**。可行 canary 收敛为组合判据：
1. `plugin add` 退出 0 + opencode.json 出现包名（装测通过）
2. 插件包目录落盘存在（XDG_DATA_HOME 下 node_modules）
3. 真激活需 `opencode run` 触发 session——但需 provider key → 留 P2 用免费模型（opencode zen/free tier）或降级 `level: install`

**P0 正式判定：通过（Level B 保底可用，激活级验证待 P2 探路）**

## Spike #6 本地验证（opencode v2.2.5 + oh-my-opencode 实装）——A3 真信号找到

**激活信号存在且可靠**：`$XDG_DATA_HOME/opencode/log/opencode.log` 里
`msg="loading plugin" id=<name> entrypoint=<path>`（role=server）
- `opencode run` 起嵌入式 server → server 启动即加载插件（非 session 懒加载，之前判断有误）
- oh-my-opencode 实装后第一次 run 即出现 loading 行 ✅
- 负信号也有现成格式：WARN `configured plugin path must be a directory`
- 插件落盘：`$XDG_CACHE_HOME/opencode/npm/<pkg>@latest/<ts>/node_modules/`
- --print-logs 在 run 模式不转发 server 日志 → 必须读日志文件

**canary 最终方案（Level A）**：run 任意 prompt → grep 日志文件 `loading plugin id=<name>`
残留小问题：CI 无模型时 run 是否走到插件加载后才失败——大概率是（加载在模型解析前），一轮 CI 收尾确认。

## 端到端实测发现（2026-11-02 本地全流程）
- seed 入库链跑通：--seed 清单注入 + 爬取合并去重 → 39 条
- 🔴 **verify canary 缺陷**：隔离 XDG env 里 `opencode run` 因无 provider 配置在 server 启动前退出 → 无 loading plugin 行 → 全量误报 failed。
  修法候选：①隔离 env 配 opencode zen 免费模型 provider ②找不需要模型的激活触发点（plugin check/serve+请求）
  → verify.yml 真跑结果将受同一问题影响，合并数据预期大量 failed 是误报，勿信

## P5a GUI/TUI 插件实测坑（2026-11-02）
- TUI 插件配置在 `cli.json` 不是 `opencode.json`（桌面提示原文）；TUI 插件需重启客户端热载
- TUI 命令注册：`ctx.keymap.layer(() => ({mode:'global', commands:[{id,title,palette:true,slash:{name},run}]}))`
- TUI `dialog.show` 收 Solid 组件工厂；纯文本用 `dialog.alert({title,message})`
- GUI bundle 白名单 require：solid-js/solid-js\/web/solid-js\/store/@opencode-*/effect/@opencode/client——**无 jsx-runtime**，JSX 不可用；且 solid-js/h 属性非响应式（急切求值）
- GUI 取数必须走 Ipc：window 沙箱无网络；`ctx.main(Token)` ↔ `main(ctx) ctx.provide(Token, impl)`；Ipc.define({id,methods:{m:{input?,output?}}})
- `effect`/`solid-js` 必须 external 进 bundle——内嵌实例与宿主 Schema 不匹配 → "Desktop IPC handler failed"
- GUI 视图用纯 DOM builder（无 JSX 无响应式），数据用 setup 预取快照

## verify canary saga (resolved 2026-11-02)

真实激活信号的完整考古：
1. `opencode run` 无 provider 早退 → dummy provider（`writeDummyProvider`，已留作工具）
2. `run` 派生 `serve --service` 在 CI 上卡死（/api/info 503 后日志静默 45s）——run 的 service 机制不适用于验证
3. 插件是**懒加载**：serve boot 不写 `loading plugin` 行，首个 API 请求才触发（log 行带 `http.span`）
4. 最终方案：`plugin add` → `serve --port 0` 后台 → curl `/api/plugin`+`/api/session` → kill → 日志查 `msg="loading plugin" id=<pkg>`
5. macOS 本地验证陷阱：opencode 不吃 XDG_CONFIG_HOME（config 读真实 ~/.config），只有 Linux CI 上 XDG 隔离才真生效
6. canary 正则兼容 `msg=`/`message=` 两种字段名
7. 分片 96 包/8 片（12/片）适配 GitHub 免费并发额度；merge 后重建 site 必须在 `checkout catalog` 之前（切分支后无 pipeline 代码）

假失败重置：canary bug 期间产生的 152 个 failed 已重置为 unverified 重验。
