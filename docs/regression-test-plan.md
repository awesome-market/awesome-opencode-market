# opencode-market 回归测试开发计划

> 目标：把本轮手工回归踩过的坑固化为自动化测试，改代码不再依赖"重启 app 点一遍"。
> 现状基线：`npm test` 103→110 用例，分支覆盖 ≥90%（CI 门禁）。

## 一、缺陷复盘 → 测试映射

本轮真实 bug 按根因分四类，每类对应一层防御：

| 根因类 | 实例 | 防御层 |
|---|---|---|
| IPC 契约不对称 | `safe.update is not a function`（schema 缺声明）；`refreshIndex` 不存在时静默假成功 | L1 契约测试 |
| 纯逻辑错误 | scoped 名 `/@\d/` 剥成空串、钉版 spec duplicate、uninstall 拿 id 当 spec、features 按 spec 存按 id 查 | L2 纯函数单测 |
| 时序/异步 | daemon inventory lag（装了闪回 add、卸了又复活）、IIFE 忘 `()`、devlog 开关吞日志 | L3 jsdom 挂载测试 |
| webview/输入怪癖 | click 被吞只有 mousedown 到、`ev.preventDefault` 不存在、按钮事件不冒泡 | L4 真实端冒烟 |

## 二、分层架构

### L0 — 现有基础（保留）

- vitest：pipeline/scan/schema/categories/features 已覆盖，门槛 branches ≥90%
- `catalog.ts` 注入式函数（`scanSkillKeys(bases, ls, hasFile)` 模式）是扩展模板

### L1 — IPC 契约测试 `plugins/market/test/contract.test.ts`（先做）

静态断言三件事，一次写死 IPC 不对称这类 bug：

```ts
// 1. methods schema 的每个 key ⇄ provide 对象字面量里的每个 key 全等
const schemaKeys = Object.keys(Market.methods)       // {input?,output?} 声明
const provided = keysOfProvideBlock()                 // 解析 m.provide(Market, {…}) 的键
expect(schemaKeys.sort()).toEqual(provided.sort())

// 2. window 侧用到的 safe.* 方法都在 schemaKeys 里（grep 源码断言）
// 3. Api 接口方法与 schemaKeys 一致（ts-morph 或文本匹配）
```

实现：不引 AST 依赖，用正则提取 `m.provide(Market, {` 块内顶层键 + `methods: {` 块内键。

**值**：`update`/`refreshIndex` 漏注册这种坑，改代码当天红，不用等 app 重启。

### L2 — 纯函数提取 + 单测

把散在 gui.ts 里的逻辑挪进 `catalog.ts`（或新 `src/spec.ts`），注入依赖：

| 提取 | 签名 | 测试用例（对应当轮 bug） |
|---|---|---|
| `cleanSpec` | `cleanSpec(s): string` | `@1930dev/opencode-usage`→不变；`@0.4.1` 后缀→剥；`name@1.2`→`name`；路径→不变 |
| `dedupeSpecs` | `dedupeSpecs(list, clean): string[]` | `['@x/y@0.4.1','@x/y']`→`['@x/y']`；已单条→不变 |
| `removeSpec` | `removeSpec(list, name, idByName): keep[]` | 钉版/裸名/id 三种匹配全删；无匹配→throws |
| `featuresMap` | `featuresMap(items): Record` | `p.id` 和 `source.target` 双 key（oh-my-openagent vs oh-my-opencode） |
| `buildExtras` | `buildExtras(specByName, idByName, idxNames): extras[]` | catalog 外的已装项进 extras |

TUI 导航状态机同步抽：

```ts
// src/nav.ts — zone/row/sel 转移纯函数
next({zone:'grid',sel:0}, 'left')  → {zone:'chrome',row:3,item:last}  // 首卡←进分类
next({zone:'chrome',row:0}, 'up')  → wrap                            // 全部更新行
next(_, 'esc', {prompt:true})      → 'close-prompt' not 'close-market'
```

### L3 — jsdom 挂载测试 `test/gui-mount.test.ts`

**原理**：`gui.ts` 的 `setup(ctx)` 是纯函数——fake ctx + 真 jsdom DOM，完整跑 window 侧代码。

基建（一次性 ~80 行）：

```ts
// test/helpers/mount.ts
export function makeApi(over): Api              // vi.fn() spy 全套方法
export function fakeCtx(api) {
  return {
    client: { plugin: { list: vi.fn(), update: vi.fn() } },
    main: () => api,
    add: (mod, opts) => { mounted = opts.content() },  // 收 DOM
    on: () => {},
  }
}
export const flush = () => new Promise(r => setTimeout(r, 0))
```

场景用例（按轮次 bug 1:1 写）：

| 用例 | 操作 + 断言 |
|---|---|
| 安装闪回 | `installed()` 第一次返回旧清单（模拟 lag）→ 点 add → flush → 卡仍显示 installed（防回弹） |
| 卸载复活 | 同上 → 点卸载×2 → `api.uninstall` 调到 → fresh 不含该 name → 卡消失 |
| 更新钉版 | `plugin.list` 返回 pinned spec → 点 update → `api.update` 被调（不是 install）|
| 刷新按钮 | mousedown 触发 → `api.index`/`refreshIndex` 调用 → status 行显示 `已刷新 N 条` |
| 设置面板 | 渲染 settingsPanel → 更新数据/导出备份/清空日志按钮存在且 handler 挂上 |
| stale host | api 缺 `refreshIndex`/`update` → 按钮显示 host 过旧而非假成功 |

关键约束：测试断言的是**行为**（IPC 调用 + DOM 文本），不内联 UI 逻辑副本。

### L4 — 真实端冒烟 `test/e2e/`（发版门禁，不进 commit CI）

两层，按成本排序：

**4a. Playwright CDP（优先做）**

```ts
// test/e2e/desktop-smoke.mjs
const cdp = await chromium.connectOverCDP('http://127.0.0.1:9222', { noDefaults: true })
const page = cdp.contexts()[0].pages()[0]
// 打开市场 → 设置 → 点更新数据 → expect(locator).toContainText('已刷新')
// 我的插件 → 卸载 → 二次确认 → expect(card).toBeHidden()
```

前置：桌面端带 `--remote-debugging-port=9222` 启动 + service 在跑。脚本做成 checklist，发版前 `npm run e2e` 过一遍（当前手工清单 1:1 映射）。

**4b. pty TUI 冒烟**

```ts
// test/e2e/tui-smoke.mjs — node-pty + xterm-headless 抓屏
const t = pty.spawn('opencode', ['/market'], { cols: 120, rows: 40 })
t.write('\x1b[<0;5;16M')                    // SGR 点击设置空白
assert(screen().includes('设置'))          // 不退出市场（c97d1e0 回归）
t.write('[A[A[A')                // 三次↑到菜单行
assert(screen().match(/1 发现/))           // chrome 聚焦
```

覆盖：esc 退出市场（c69b4ae）、滚动条点击 dismiss（eb5ae97）、三行导航（3322281）、pageup/down（27f98af）。

**4c（可选）computer-use 模型**

定位：**候选清单制**——开发中发现"程序断言难/需要真实环境眼看"的场景随时补充到下表，攒够量再决断要不要上模型层。

当前候选：

| 场景 | 为啥难程序化 |
|---|---|
| 卡片 badge 像素位置/融合效果 | 位置是视觉验收，DOM 断言断不了"骑缝 1/3 在外面" |
| 蓝底选中态颜色 token | 断的是"颜色对不对"，截图比对才靠谱 |
| spinner 旋转动画 | 动态效果，CSS 断言不到"在转" |
| 提示"闪一下恢复"类时序感知 bug | 需要看真实时序序列（本轮大部分 bug 都是这类） |
| webview 事件怪癖复现 | click 被吞/preventDefault 缺失——模型点真环境才看得到 |
| 全部更新占位符这类"看着像做了"的功能 | 断言 IPC 能抓，但"用户视角是否真的有效"模型验证更直接 |

决断标准：候选里**≥3 个**是"程序断言做不了只能靠眼看"时再上 computer-use；否则 Playwright 选择器+截图比对就够。

## 三、实施顺序与工作量

| 阶段 | 内容 | 验收 |
|---|---|---|
| P1 | L1 契约测试 + L2 spec/features 提取单测 | `npm test` 新增 ~20 用例绿；手改 schema 漏 provide → 红 |
| P2 | TUI nav 状态机抽 `src/nav.ts` + 单测（tui.tsx 同步改用） | 方向键组合全表覆盖 |
| P3 | L3 mount 基建 + 6 场景用例 | jsdom 里点完所有按钮，IPC spy 断言全绿 |
| P4 | L4a CDP 冒烟脚本 + `npm run e2e` | 真实桌面端跑通 checklist |
| P5 | L4b pty TUI 冒烟 | 手工复现过的 4 个坑全部脚本化 |

P1+P2 纯本地，无环境依赖；P3 需要 vitest `environment: 'jsdom'`（已装 vitest，仅需加 devDep `jsdom`）；P4/5 需本机环境，进 `e2e` script 不进 CI。

## 四、目录改动

```
plugins/market/
  src/
    spec.ts          ← L2：cleanSpec/dedupeSpecs/removeSpec/featuresMap/buildExtras
    nav.ts           ← TUI 导航状态机
    gui.ts / tui.tsx ← 改为调用提取后的函数
  test/
    contract.test.ts     ← L1
    spec.test.ts         ← L2
    nav.test.ts          ← L2
    helpers/mount.ts     ← L3 基建
    gui-mount.test.ts    ← L3
    e2e/desktop-smoke.mjs ← L4a
    e2e/tui-smoke.mjs     ← L4b
```

规则约束：测试只断行为不断实现细节；gui.ts 里 require 的 node:* 部分（main 侧 provide）不进 jsdom，单测走 L2 提取函数。

## 五、完整覆盖矩阵

> 第一层"对症版"只防本轮 bug。补全后按功能域保证"能用→状态对→错处理"三条基线。

### L2 纯函数补全

| 域 | 函数/位置 | 用例 |
|---|---|---|
| **skill 生命周期** | `installSkillTar` / `writeSkill` / `installSkillDir` / `scanSkillKeys` / `skillInstalledVer` | tarball 解压落盘、global/project 双 scope、`<base>-*` lifted skills、版本探测、空目录/隐藏目录跳过、`<name>` dir 标记语义 |
| **spec 解析** | `cleanSpec`/`dedupeSpecs`/`removeSpec`/`featuresMap`/`buildExtras` | scoped/pinned/裸名/路径全形态（本轮 bug 已列） |
| **nav 状态机** | `src/nav.ts` | 方向键全表、prompt 拦截、wrap 边界、pageup/down、grid↔chrome 过渡、settings 焦点 |
| **激活验证** | `verifyActivation` handler | activated / restartNeeded / verify-pending 三分支、plugins.json 状态读取失败 |
| **过滤排序** | `search`/`sortEntries`/`allCategories`/`inDays`/`hasUpdate` | 查询匹配、分类+收藏+分组+时间+部件叠加、asc/desc 反转、空结果、日期边界 |
| **状态持久化** | `loadState`/`saveState`/备份导出恢复 roundtrip | favorites/groups/notes 序列化↔反序列化、损坏 JSON 容错、TTL 过期→fetch 失败→snapshot fallback |
| **管道** | `preAdmit`/`looksLikeTemplateSpam`/`hasPluginEvidence`/`merge`/`slugOf`/`detectFeatures`/`classify` | 三个发现通道、模板垃圾拒收、证据门、old-index merge 字段保留、exports 子路径部件 |
| **安全脱敏** | `redactLog`/`keyLines` | home 路径/token/API key 不出现在导出日志、行过滤 |
| **skill 权限/源** | `skillPermission`/`skillSource`/`installSkillDir` IPC | allow/deny/ask 模式读写、HTTP catalog 开关、global/project scope 选择落盘 |
| **取消安装** | `cancelInstall` IPC + 卡片 × 按钮 | 安装中点 × 杀子进程、任务表清理、取消后状态复位 |
| **导出日志** | `exportLog` 按钮 + `redactLog`+`keyLines` 链 | 点击导出→含脱敏文本、行数截断、无日志时空态 |
| **插件形态推断** | `looksLikePlugin` | exports/main/opencode 字段 → plugin/maybe/no 三分支 |
| **详情页** | `detailView` | findings/redFlags 默认收起、备注输入保存、版本/来源/分类完整展示 |
| **i18n** | `t()` + EN/ZH 表 | 所有 I18nKey 双语齐全、缺 key 不崩 |
| **数据时间** | `indexAge` | "x 分钟前/x 小时前" 格式化、无索引时空态 |
| **TUI 弹层体系** | menu overlay/prompt/settingsItems | 筛选选中态、菜单项 hover/键盘一致、prompt 字符输入+esc 拦截、settings 焦点循环 |

### L3 jsdom 挂载补全（每个功能区块"能用→状态对→错处理"）

| 区块 | 用例 |
|---|---|
| **安装/更新/卸载** | add→spinner→installed、update→版本升、卸载→卡消失；stale inventory 防回弹；失败保留 error 按钮 |
| **全部更新** | batch 流程：多插件并发进度、部分失败其他继续、无更新时"全部已是最新" |
| **收藏/分组/备注** | ★ 切换、分组赋值、备注输入、备份导出→恢复 roundtrip 后状态一致 |
| **搜索过滤** | query 输入过滤列表、分类/收藏/分组/时间/部件多条件叠加、空结果提示 |
| **设置** | 更新数据按钮真刷新、devlog 开关、备份恢复、清空数据二次确认、日志框显示文件日志 |
| **弹层/详情** | 筛选菜单选中态、详情页渲染、卸载确认武装态 3s 复位 |
| **已装视图** | extras 合成卡（uncataloged）、mixed plugin+skill 双 tab、features 部件段、版本徽标 |
| **错误边界** | api 抛错各按钮变 failed+错误文本、host 过旧提示（非假成功）、IPC 超时 25s 兜底 |

### L4 真实端冒烟补全（CDP + pty checklist）

| 端 | 场景 |
|---|---|
| **桌面 CDP** | 市场打开渲染、刷新按钮、安装→已装、卸载→消失、钉版升级、全部更新、收藏、设置各按钮 |
| **TUI pty** | 三行导航、方向键 wrap、pageup/down、esc 各路径（搜索/prompt/弹层/市场）、滚动条点击、卡片 hover、S/T/G/R chips |
| **管道 e2e** | `tsx pipeline/run.ts --out` 完整跑（fixture 源）、verify/merge/site 链 |

## 六、实施顺序（修订）

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P1** | L1 契约测试 + spec/features/nav 纯函数提取单测 | 本轮 bug 全部有失败用例→修复→绿 |
| **P2** | skill 生命周期 L2 + L3 mount 基建 + 安装/卸载/更新场景 | skill 全链覆盖 |
| **P3** | L3 剩余区块（设置/搜索/收藏/全部更新/错误边界） | mount 测试覆盖所有用户操作面 |
| **P4** | L4a CDP 桌面冒烟 + L4b pty TUI 冒烟脚本 | 发版 checklist 一键跑 |
| **P5** | 管道容错+激活验证+脱敏单测 | L2 补全 |

## 七、原则

- **功能开发即测试开发**——新功能合并时带对应 L2/L3 用例，不后补
- **行为断言，不内联实现**——测试断言 IPC 调用+DOM 文本+函数输出，不复制被测逻辑
- **真实数据不猜**——features/分类等有真实来源的字段断言实际值，无来源的断言"未收录/不显示"
- **jsdom ≠ webview**——webview 事件怪癖归 L4，不强求 jsdom 复现
- **进 CI 范围**：L1-L3 进 `npm test` commit 门禁（覆盖≥90%）；L4 发版前手动 `npm run e2e`
