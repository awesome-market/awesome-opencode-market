# AI 审核与上架管线设计

> 状态：设计定稿 v3，待实现。
>
> v3 相对 v2 的关键变化：
> - **队列统一**：取消 issue-label 上架池，改为 index 级 `approval` 字段 +
>   `ai-verdicts.jsonl` 写回通道（投稿与发现条目走同一条路）
> - **hold 是默认态**：版本 bump 自动挂起 `pendingVersion`，展示版本 =
>   最后被批准的版本——不再有"先展示后追回"的毒版暴露窗
> - **verify 钉装**：修复版本错位 bug + verify 测的就是用户将装的版本
> - 客户端钉装 `name@approvedVersion`，把目录从咨询层变成真闸门

## 1. 目标与原则

大部分插件自动审核上架；人只做两件事：**每天看日报**（可否决）+
**处理风险件**。设计假设人的注意力会退化到零——安全底线由机械红线 +
AI 客观判定构成。

核心语义：**用户能装到的版本 = 机械红线 + AI 都通过的版本**。
展示的、被装的永远是"最后批准的"，不是"最新的"——滞后是 feature。

## 2. 验证深度现状（云端）

| 层 | 状态 | 做法 |
|---|---|---|
| L1 静态分析+装+加载 | ✅ | `scanTarball` + `plugin add` XDG 隔离 + `serve` canary |
| L2 TUI 交互级 | ❌ 二期 | `tmux` 驱动 + `capture-pane` 断言（Linux runner） |
| L3a GUI 真实渲染（主） | ❌ 二期 | `serve` 自带 web UI + Playwright headless：断言插件 GUI 元素渲染/console 无插件报错/截图留证 |
| L3b 真 Electron（兜底） | 可选 | xvfb + AppImage + `--no-sandbox` + CDP DOM 检查——仅当 L3a 与桌面表现出现分歧时启用；~200MB 下载、flaky 风险高 |
| Windows 兼容 | 可选 | public repo runner 免费；无 pty，只跑 serve headless |

**L3 设计依据**：desktop 是 Electron 套 serve 的 web UI，GUI 插件
（`exports["./gui"]`）渲染目标是同一份 web 前端——Playwright 的
headless Chromium 与 Electron renderer 同源，断言"插件 GUI 能不能
渲染"几乎等价，且能拿结构化错误（console/network）而不只是截图。
L3 按需触发：仅对有 `./gui` entrypoint 的包跑（绝大多数包没有）。

安装/运行测试一律云端，本机不做任何装测。

## 3. 总体架构（v3）

```
投稿/发现 → catalog run
   ├─ 新条目      → entry { approval: pending }      （不进展示面）
   ├─ 版本 bump   → entry { pendingVersion: 新版 }    （展示钉在旧批准版）
   └─ 无变化      → 复用

verify run（钉装 pendingVersion/最新批准版测试）
   → 装不上的版本直接 concern，不耗 AI token

本地 AI（每小时，断网自动补）
   → 拉 pending 条目 + pendingVersion
   → L0.5 注入检测分类器（专用小模型，产出信号非裁决；高分→直接 concern 转人工）
   → 全量审（物料=包内容+scan+verify结果+信任信号+L0.5分数，去散文）
   → ai-verdicts.jsonl 写回 catalog 分支（{name,version,pass|concern,reason,source}）

下一趟 catalog run 读 verdicts
   ├─ pass    → approval: approved / pendingVersion 释放为展示版
   └─ concern → 保持 pending + finding（进人工队列）

人工通道（等价二选一）
   ├─ issue 评论 /approve（owner）
   └─ issue 勾 submission:approved（triage+）
   → approve job 往 ai-verdicts.jsonl 写 source:human 的 pass

日报（本地 cron 21:00，固定 issue 盖楼）
   ① 明日上架（verdict=pass 还没跑过 catalog）
   ② pending 中（等 AI 审）
   ③ concern 挂起（等人工）
   → 否决动作 = 往 ai-verdicts.jsonl 写 source:human 的 concern / 人工改 verdict
```

## 4. schema 变更（src/schema.ts）

```ts
// entry 新增字段
approval: 'approved' | 'pending' | 'legacy'
//   approved = AI/人工批准过，展示
//   pending  = 未过审，站点过滤不展示
//   legacy   = 存量迁移态：正常展示但标注"早于 AI 审"，backfill 逐批升级
latestVersion: string           // 语义变为"最后批准版"（客户端钉装目标）
pendingUpdate?: {
  version: string               // 被挂起的新版本
  capabilities: Capabilities    // 新版自己的扫描结果（与展示字段隔离）
  verification: Verification    // 新版的装测结果
  findings: string[]
  reason?: string               // AI concern 理由 / awaiting-review
  heldAt: string
}
```

**release 语义**：`pendingUpdate` 获批 → `latestVersion = pendingUpdate.version`，
capabilities/verification 提升为展示字段，`pendingUpdate` 清除。
新版再被挂 → 独立重审（hold 按版本键控，不累积阻塞）。

**写回通道**：catalog 分支 `ai-verdicts.jsonl`（同 submissions.txt 模式）
`{name, version, verdict: pass|concern, reason, at, source: ai|human}`

## 5. AI 二审：任务收窄 + 去语义化输入

**权限模型：否决权，不是特赦权。**

| 输入状态 | AI 可判 | 注入最坏结果 |
|---|---|---|
| pending（新条目/新版本） | pass / concern | 骗"pass" → 回到机械 clean 基线，不更差 |
| 机械 redFlags | （只起草，无裁决） | 注入无法突破机械红线 |

```
system: 安全审查员。对物料判定 pass|concern，逐信号给技术理由。严格 JSON：
        { "verdict": "pass"|"concern",
          "signals": [{ "finding": "...", "tp": bool, "reason": "..." }] }
user:   <data>
        - 结构化元数据（name/version/maintainers/createdAt/repoId 变更）
        - 机械 findings/redFlags（规则:文件:命中行）+ 命中代码行摘录
        - 包源码（限流：入口→生命周期脚本→源码到上限；跳 minified/bundled）
        - verify 结果（装得上/加载通/日志摘录）
        - 上下文信号：休眠 >30d 推版 / maintainer-changed / name-reused
        </data>
```

不喂：描述、README、issue 散文、他人评论——残余注入只能藏代码行里且
要先骗过机械规则；最坏回落基线。**超限包默认 concern**（审不完走保守）。
**输出校验**：严格 JSON schema；非 pass 一律 concern；解析失败也 concern。

**tarball sha 去重**：同内容重发/re-tag 跳过不重复审。

### L0.5 注入检测分类器（专用模型，信号非裁决）

通用 LLM 审核时必须语义"读懂"被审文本 = 可被说服；专用分类器只做
模式打分、不执行指令——对注入的免疫是**结构性**的。它补的恰是 LLM
最弱的一格（被话术绕进去）；LLM 补它覆盖不了的语义意图。

**产出 = 信号**：分数+类别 → 超阈值直接 concern 转人工（不耗主审
token）；分数也进主审物料作为提示。本地毫秒级，全部件可跑。

**L0.5 是可换插槽，不绑定模型**：接口 = `score → 阈值 → finding`，
`modelId+version` 记入审计元数据，随领域演进换血——分类器不会因
时间失效，但**覆盖面**会随新攻击手法老化。

**候选开源模型**（2026 格局，按独立评测排序，发布分数只当初筛）：

| 模型 | 规模 | 实测表现 | 许可 |
|---|---|---|---|
| `usezn/Galvanize-2` | 141M | **训练目标即"AI coding agent 实际所见"**——域最对口；83.4% 检出 / 0.81% FPR、多语言 | Apache-2.0 |
| `Horizon-Labs/prompt-injection-guard-*` | 141M/308M | 独立评测注入捕获 82.2%@1%FPR（当前公开最佳档），开源评测套件可自建基准 | Apache-2.0 |
| `ibm-granite/granite-guardian-*`（3.x/4.x） | 2B/8B | **BYOC 自定义判据**——定义"审核者定向文本/教唆 agent 外联"专属标准，填注入检测与意图判断之间的空档 | Apache-2.0 |
| `meta-llama/Llama-Prompt-Guard-2-86M` | 86M | 一年多老模型，已跌至第二梯队（69.4%@1%FPR，AUC 0.883）；有公开 bypass 研究——**保留作多样性投票，不当主闸** | Llama |

**推荐组合**：Galvanize-2 / Horizon 当快速全量闸 + Granite Guardian
BYOC 第二判据 + PG2 第三票（多样性）。产出皆信号，裁决走保守漏斗。

**基准自建**：所有分类器训练语料高度重叠、威胁模型是"聊天注入"——
与"skill 本身是指令文本"分布不同，发布分数必须打折。上线前用
catalog 真实语料 + 合成攻击集自建 eval（Horizon 开源评测套件可复用）。

**已知局限如实写**：注入检测是军备竞赛，各分类器均有非零绕过率；
看着正常的恶意引导不在注入检测覆盖内。不确定一律转人工。

### 品类×审查矩阵（skill / MCP 纳入时的差异）

市场含 skill 与 MCP（未开发）。载荷类型不同，管线重心不同：

| 品类 | 恶意载荷 | 机械层 | verify | AI 角色 |
|---|---|---|---|---|
| 插件 | 代码（exec/eval/混淆） | 代码扫描（现有） | 装+加载（+渲染） | 二审 |
| skill | **指令文本**——毒通过 agent 推理执行 | 换 skill 专用信号：指令内嵌 shell/远程抓取/凭据访问/unicode 混淆/审核者话术 | 仅文件完整性（无"运行"概念） | **主审**——几 KB 全文可喂，L0.5 必跑 |
| MCP | server 代码 + **tool descriptions**（prompt 材料） | 代码扫描 + 描述信号 | 起进程+handshake+`tools/list` | 二审，但描述字段按 skill 规则审 |

skill 投毒的本质区别：毒必须写在明面上（藏了就毒不到人）——同一文本
既要教坏终端 agent 又要骗过审核器，还要躲 L0/L0.5 的模式识别，三个
载荷互相暴露。**残余窄缝如实承认**：看着完全正常的微妙坏引导可能漏
过——事后靠 blocklist tombstone 兜底，徽章按品类分层措辞（skill 只能
说"已过审"）。

版本 bump → `pendingVersion` 自动挂起（hold-by-default）→ verify 装测
新版 → AI 全量重审 → pass 释放 / concern 挂起。休眠唤醒、维护者变更
作为高疑信号进物料。**每版都过 AI，发包频率不产生额外工作量**（每条目
每趟 ≤1 次，AI 审的是最新版，中间版永远轮不到）。

github-kind 条目无版本号：用 `pushedAt`/tree-sha 变化做复审触发——
近似语义（repo 无不可变快照），记录在案。且其内容"活着"无法真钉
版本：复审 concern 只能把 `approval` 打回 `pending` 事后撤下，不是
gate——结构性限制如实写。

## 7. 现网 bug：verify 版本错位（独立修复）

`verify/merge.ts` 按 name 写回 verification——verify 装的是"测试时刻的
npm latest"，条目记录的是"catalog 时刻的版本"：catalog 收录 v1.2 后 npm
发了 v1.3，verify 测的是 v1.3 却把 verified 贴在 v1.2 条目上。

**修法**：分片文件写 `{name, version}` 对，verify 装 `name@version`——
测的就是用户（钉装后）会装的版本，错位在结构上消失。

## 8. 客户端钉装（已实测，opencode v2.2.5）

```diff
- opencode plugin add <name>          → npm latest
+ opencode plugin add <name>@<entry.latestVersion>  → 批准版
```

实测结论（隔离 XDG 环境）：

- `plugin add name@x.y.z` **可用**：config `plugins` 数组写入全 spec，
  装的就是该版（wakatime@1.3.8 验证）
- **精确 pin = 硬底**：`oh-my-opencode@5.1.59` 钉住后 `plugin update`
  报 "No updates available"（5.1.60 存在也装不上）——pin 挡住的
  不只是我们客户端，`plugin update` 本身也越不过去，闸门是绝对的
- **升级 = 改写 config spec**：手动把 `plugins` 里 `name@old` 改成
  `name@new` + server 重启 → opencode 自动解析装新版。`plugin update`
  在钉装下无关——它的 `<target>` 必须精确匹配配置 spec，裸名报
  "not configured"
- `plugin` / `plugins` 是两个键：`plugins`（复数）= 新 API 托管包
  （`plugin add` 写入、`check`/`update` 管理）；`plugin`（单数）=
  旧式 source 插件。客户端写配置用 **`plugins`**，与 `plugin add` 一致
- `plugin add` 有 entrypoint 门：包需在 `exports` 声明
  `./server`/`./tui`/`./gui` 之一，否则 add 直接拒绝——这意味着
  verify 的 `plugin add` 路径只覆盖新 API 包，旧式包需走
  `plugin:` 数组 + 加载测试的另一条 verify 路径（覆盖率差异，记录在案）

`hasUpdate` 比较对象不变（catalog.latestVersion=批准版）——npm 有新版
但目录未批准时更新按钮不亮，**滞后是 feature**。
skill 走 `installSkillTar` 独立路径，同步钉。
保护范围 = market 插件用户；手动 CLI 用户仍是咨询层。

## 9. submit.yml 改动点

1. `issues.types` 加 `labeled`；review `if` 精确到 `opened|edited|合格评论`
   （评论排除 bot、`ai-diag`、`/approve` 开头）
2. verdict 映射：clean→`submission:ai-review`（初审过，等 AI，不自动 ingest）、
   flagged→needs-work、invalid→invalid；needs-work/invalid 时清 ai-diagnosed
3. 新增 `approve` job：labeled `submission:approved`（排除 bot sender）或
   owner `/approve` → 往 ai-verdicts.jsonl 写 source:human pass + 确认评论
4. ingest 保留（clean→ingest→条目落 pending），语义变为"进待审队列"
5. notify-published 判定条件改：`approval === 'approved'` 才发"已收录"——
   ingest 不等于上架

## 10. run.ts / merge.ts 改动点

- 复用检查：`cand.version === (prev.pendingUpdate?.version ?? prev.latestVersion)`
  ——挂起版不重复扫
- 版本 bump → 写 `pendingUpdate` 而非覆盖展示字段
- 版本回退检测同样比 `pendingUpdate?.version ?? latestVersion`——挂起
  版存在时拿 npm latest 对钉住的展示版比较会每趟误报 rollback
- 读 ai-verdicts.jsonl：pass→释放/approved；concern→保持+reason
  - verdict 按 `name@version` 键控：v1.3 的 pass 不会误放 v1.4；
    旧 verdict 自然失效，文件 append-only 无清理需求
  - 人可"预批准"：verdict 先于 pendingUpdate 落盘也无害——条目
    落 pending 时 verdict 已在，同趟即释放（by design）
  - 两个写者（本地 AI 直推 + GitHub approve job）→ push 冲突时
    fetch+rebase 重试，同 ingest 现有模式
- 新条目 → `approval: pending`；存量迁移 → `approval: 'legacy'`
- verify plan 扩选：除 `unverified` 外补 `pendingUpdate` 目标与
  `approval:'pending'` 条目；结果按 name@version 写入
  `pendingUpdate.verification` 槽位（version 匹配时）

## 11. 本地组件

- `pipeline/ai-diagnose.ts`：拉 pending 条目+pendingUpdate → L0.5 分类器
  → 全量审 → 写 ai-verdicts.jsonl + 推 catalog 分支；
  needs-work/invalid issue → 草稿评论
- 注入检测模型（可换插槽）：Galvanize-2 / Horizon 全量闸 + Granite
  Guardian BYOC 第二判据 + PG2 第三票；皆信号源非裁决，
  `modelId+version` 记入审计元数据
- `pipeline/publish-digest.ts`：日报三节（明日上架/pending 中/concern 挂起）
- launchd：ai-diagnose 每小时、digest 每日 21:00；key 在 `~/.config/`
- AI 故障 = fail-closed：新内容冻结 pending，已上线不动；超时告警

## 12. 安全边界

| 边界 | 依据 |
|---|---|
| 展示=批准版，装=批准版 | hold-by-default + 钉装，毒版到不了用户 |
| AI 无特赦权 | redFlags 只起草；误判方向恒保守 |
| 输入去散文 + 严格 JSON 输出 | 注入面最小化，无自由文本藏私货 |
| 本地零执行 | 装测全在云端零 token 沙箱 |
| 日报≠审批，是反悔窗 | 人注意力归零时保底成立 |
| AI 写回走 ai-verdicts.jsonl | index.json 仍是唯一事实源，verdict 只是输入 |
| fail-closed 冻结 | 无 fail-open 后门 |
| `/approve` 限 owner；labeled 排除 bot | 人通道不被 AI/自身循环触发 |

## 13. 边界情况

| 场景 | 结果 |
|---|---|
| 批准不存在的包 | packument 404 → 不落，无害 |
| 误批/事后发现毒版 | blocklist 下架（tombstone） |
| 想拦 pending 中的 | 写 human concern 进 verdicts，或 AI 挂起时人工复核 |
| 版本风暴 | 只审最新版；每趟限一次；中间版永不消耗 |
| 休眠后投毒 | 高疑信号进物料；hold 保证毒版只进审计面 |
| AI 挂掉 | 更新冻结 pending，存量不动，告警 |
| 存量迁移 | legacy 展示标注，backfill 逐批升级，不清空站点 |

## 14. 不做清单

- AI 不裁决 flagged/invalid（只起草）
- 不做定时轮询式重审（同内容+同模型=重复采样；只跟事件）
- 不在本机执行投稿代码
- 不做 TUI/GUI 实时测试（二期 L2/L3a；真 Electron L3b 仅兜底按需）
- 不做 verify 失败 AI 归因（三期）

## 15. 验收清单

- [x] `opencode plugin add name@x.y.z` 版本 spec 实测可用（v2.2.5，
      wakatime@1.3.8 / oh-my-opencode@5.1.59 验证；精确 pin 为硬底，
      `plugin update` 无法越过；升级=改写 `plugins` spec 后 resolve）
- [ ] clean 投稿 → entry 落 `pending`，不展示不安装
- [ ] AI pass → 下趟 catalog 变 `approved` 展示
- [ ] AI concern → 保持 pending + reason，进人工
- [ ] 版本 bump → pendingVersion 挂起，展示钉旧版；pass 后升级
- [ ] 挂起版不重复全量扫；rollback 检测不误报
- [ ] verify 测的版 == 条目批准版（无错位）；覆盖 pendingUpdate 目标
- [ ] 客户端装 = `plugin add name@latestVersion`；升级 = 改写
      `plugins` spec → reload（不用 `plugin update`）
- [ ] 日报三节齐全；人工 verdict 写回生效（含预批准）
- [ ] 存量条目 `approval: legacy` 正常展示
- [ ] 断网时段静默，恢复补跑
