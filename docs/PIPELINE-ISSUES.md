# 管线缺陷与改进清单（2026-11）

> 代码走查 + 线上 index.json 实证的 issue 清单。每条注明证据位置、影响、修法。
> 相关文档：`docs/DEV.md`（实现）、`docs/RESEARCH.md`（立项依据）。

---

## 一、数据正确性（线上正在发生）

### I-1 slug 唯一性破坏：monorepo 撞车（实证）

**现状**：`slugOf({repo})` 对所有指向同一 repo 的 npm 包产出同一 `owner/repo` slug；`slugOf` 有 `subpath` 参数但 worker 从不传（`pipeline/run.ts` entry 构造处）。merge/buildIndex 无唯一性校验。

**实证**：线上 index.json 496 条中 15+ 个 slug 重复：`rizal72/opencode-plugins` ×5、`noppu-labs/ai-toolkit` ×4、`alexeyshirshov/skills` ×3 等。

**影响**：详情页 URL 撞车、"slug 一生成不可变"铁律（DEV §4.6）破坏、下游消费者拿到歧义主键。

**修法**：
- 消歧规则：npm 名优先于 repo（npm 名才是稳定身份；scoped 名还天然免疫抢注，见 §五）。monorepo 多包共用 repo 时 slug 用 `name` 而非 `owner/repo`。**权衡说明**：owner/repo 设计本意是合并"同一项目多个 npm 名"（改名重发、镜像包）——npm 名优先会把这类包拆成两条目；反向风险是"模板残留"（fork 模板忘改 repository 字段，几十个包同指上游 repo）在 repo-key 下反而被错误合并还继承模板 repo 的 stars。综合来看安装单元是 npm 包不是 repo，name-key 更贴近实际。
- 存量修复：撞车条目选规范 slug，旧 slug 写入 `aliases`（schema 字段已有，目前无写入方）。
- merge 末尾加 slug 唯一性断言，重复即 fail（防回归）。

### I-2 merge cacheKey 混层：每发一版丢身份字段

**现状**：`mergeEntries` 用单一 key `name@latestVersion+opencodeVersion`（`pipeline/publish/merge.ts:8`）。版本 bump → fresh 条目 key 变化 → prev 查不到 → `firstSeenAt` 重置为 now、`aliases` union 失效、`discoveredVia` 丢 submission 来源。版本回滚（dist-tags 倒退）同路径触发。

**影响**：site 详情页 'first seen' 每发一版刷成当天（用户可见的错误数据）；verification 重置是设计内（per-version freshness），但身份字段不该陪葬。

**修法**：两层 key——
```
身份字段（firstSeenAt/aliases/discoveredVia/slug）：按 name（npm 名）匹配迁移
per-version 字段（capabilities/verification/latestVersion/publishedAt）：按 name@version+host
```

### I-3 categories 注册表只读旧值

`categories: old?.categories ?? {}`（merge.ts）——classify 若产出新 id，条目引用注册表中不存在的类目。修法：union `old.categories` 与本轮实际用到的 id。

### I-4 catalog 分支双写竞争（实证）

`catalog.yml` 和 `verify.yml` 的 merge job **都** `checkout -B catalog origin/catalog` 后 commit+push，但分属两个 concurrency group（`catalog` / `verify`）。定时错开（03:17 vs 04:47）平时没事，手动 dispatch 或 catalog 跑超时重叠时：先 push 的成功，后 push 的 non-fast-forward 被拒——**verify 整轮结果作废**（artifact 只留 7 天）。不会写坏数据（push 会拒）但是纯浪费。修法：两个 workflow 共享一个 `catalog-branch` concurrency group，或 push 前 `git pull --rebase` 重试环。同理两边都 deploy Pages，verify 侧 `continue-on-error` 已兜。

### I-5 扫描规则无版本号：规则升级不重扫旧包

`pipeline/scan/rules.ts` 的 `RULES` 无版本标识，`capabilities` 缓存键只有 `name@version`——**规则集升级后，未发新版的存量包永远带着旧规则的 findings**。新规则能抓的恶意模式对老包不可见。修法：`rulesetVersion` 写进 `capabilities`，cacheKey 变 `name@version+host+ruleset`——版本不变规则变也要重扫（tarball 可复用缓存，只重跑规则）。

---

## 二、失效处理（现状：静默消失）

**核心问题**：失效条目无任何标记，直接从下轮 index 消失。无墓碑、无 gone 态、无原因记录。仅 `corruptionGate` 总量 >20% 兜底。

### F-1 各失效路径现状

| 场景 | 现状 | 信号 |
|---|---|---|
| npm 下架 | discover 搜不到 / packument 404 → `if (!pk) return` → 消失 | 无 |
| npm deprecated | `deprecated: true` 保留 | ✅ 唯一有标记 |
| repo 删除 | fetchRepoMeta null → stars/license null | 与"本无 repo"不可分 |
| repo 改名/转移 | npm repository 字段变 → 新 slug → 旧条目消失+新条目当全新 | aliases 死字段接不住 |
| evidence gate 翻转 | 新版摘掉 keyword/exports → 消失 | 包在 npm 上仍在 |
| spam-owner 翻转 | owner 触线 → 名下全灭 | 无告警 |
| cap 挤出 | `admitted.slice(0,500)` 尾部淘汰 | 排序随 npm relevance 漂移，轮流假死 |
| transient 故障 | packument `!res.ok → null`，404/500/429 一视同仁 | 假死当真死 |

### F-2 修法：removed 段 + 复查步骤

```jsonc
"removed": [{
  "slug": "owner/repo",
  "lastSource": { "npm": "name", "repo": "owner/repo" },  // 名字复用检测要用
  "disappearedAt": "...",
  "reason": "npm-404 | timeout | filtered | capped"        // 需显式复查才能分清
}]
```

- 消失不立即删：进 `removed` 段保留 N 天缓冲，期间复活则原样恢复（防 discover 抖动杀数据）。
- 价值：slug URL 不 404（"URL 稳定是资产"）、已安装用户查得到下落、diff 有删除原因、下游消费者拿到结构化 delete 事件、gate 可按 reason 精判。
- `fetchPackument` 必须先区分 404 vs transient，否则 tombstone 会记假死。

---

## 三、规模化（500 条已在顶格）

### S-1 三堵墙（按撞上顺序）

| 墙 | 位置 | 阈值 |
|---|---|---|
| GitHub API 额度 | `GITHUB_TOKEN` = 1000 req/hr/repo；每条目 ≤3 次 GH 调用（repoMeta + 2×fileExists） | ~330-500 条/小时 |
| job timeout | catalog.yml `timeout-minutes: 60`；BATCH=10 并发、~5 串行 await/条目 | ~5-10K 条 |
| 发现层 | npm search ~1000/keyword × 3 关键词（重叠高） | 候选池 ~2-3K 封顶 |

另：verify.yml 每 run 48 条上限（4 shard × 12），规模大了待验证队列永远追不上。

次级风险（未定量，先记账）：
- **npm 侧公平使用**：万级 packument+tarball 日拉取可能触发 registry 节流——diff pass 可用 abbreviated packument（`Accept: application/vnd.npm.install-v1+json`，体积小且含 time/dist-tags）降载。
- **index.json 体积**：496 条已数百 KB，万级约 20MB 单文件——下游消费者拉全量会疼，届时考虑分页或按类目分文件。
- **workflow 分钟数**：公共仓库免费，若转私有 2000 分钟/月很快烧完（verify 沙箱最耗）。

### S-2 修法：增量短路 + pending 队列（不是分时 sharding 先行）

**每日 planner（便宜）**——npm search 结果自带 version/date，无需逐包 packument：
```
候选 vs 旧 index 差分 → pending.json（写 catalog 分支）：
  new        候选有、索引无
  updated    name 同、version 不同（含 dist-tags 回滚）
  gone-check 索引有、候选无 → 复查 packument 确认 404 → removed
  meta-stale metrics.checkedAt > 7d → 只刷 stars/downloads/deprecated/repo 存活
未变且未过期 → 整条目复用（0 GH 调用，npm 仅 1 次 search 内开销）
```

**hourly worker**：按 `hash(name)` 确定性分片消化 pending（不用列表序——否则复制 500-cap 抖动），分区写回 index（union 更新非全量替换），gate 按分区算。

**关键约束**：merge 不能保持"fresh 全量替换"语义，要改分片所有权模型；cron 不可靠（会漂移），任务队列落盘不依赖准点。

**注意盲区**：`npm deprecate` 不 bump 版本——版本键短路漏 deprecation 翻转，meta-stale 刷新必须带 deprecated/description 字段。

**对比结论**：分时 sharding 可绕过限速（每 run 新配额）但须重写 merge 且索引跨天拼接；增量短路把日常成本从 O(N) 压到 O(changed~2%)，是同目标更小手术。真到万级再上哈希分片兜底。

---

## 四、死代码 / 未兑现流程

### D-1 ghList 算了不用（实证）

`ghList` 过滤后只进日志（run.ts:60-72），`queue` 只装 npm 侧 `admitted`。GitHub-only 插件（无 npm 包）**永远进不了索引**；`preAdmit` 的 archived/fork 过滤作用于死列表。每轮白烧 GitHub search API（search 限额 30/min）。决策：接线（定义 git-source 条目 schema + `plugin add` git specifier 装测路径）或砍掉。

### D-2 投稿管线 write-only（实证）

submit.yml 全流程：静态审查 → 评论 → 打 label → close。**完。** approved 投稿无任何步骤写入 seed/index；`--seed` 入口存在、`discoveredVia:'submission'` 在 schema 里存在，catalog.yml 从不传 seed。缺关键词的 approved 投稿静默蒸发。附带 bug：`grep -oE` 从 issue 正文抓第一个形似包名 token，散文正文会抓错。决策：approved → 写 seed 文件进 catalog 分支，或直接补 index；否则关掉入口别假装有投稿制。

### D-3 死字段

`aliases`（merge 有 union 但无写入方）、`replacement`（永远 null——deprecated 消息原文 "use X instead" 可自动填）、`compat:{}`（从不填）、`slugOf` 的 `subpath` 参数（从不传）。

### D-4 `.opencode-market.json` 规格未实现（实证）

DEV.md 定义了"仓库根放 `.opencode-market.json` 声明 category/description"的元数据约定，代码中 grep 零命中——从未实现。要么补上 fetch 逻辑要么从 DEV.md 删掉，规格与实现不一致是文档债务。

---

## 五、供应链安全（metadata → delta → 沙箱 三层）

**威胁模型修正**：npm 自助下架限 72h、版本号一次性、scoped 名只有 owner 能发 → "无 scope 名抢注"攻击面窄；**主战场是账号劫持发新版**——包不重建，`time.created` 不变，`_npmUser` 还是真账号，metadata 信号全失效。

### SEC-1 待落盘的身份字段（一次改 Packument 全有）

`time.created`、`time.modified`、`maintainers`/`_npmUser`（逐版本发布者）、`dist-tags` 全表、deprecated 消息原文、`dist.integrity`。GitHub 侧：repo 数字 `id` + `created_at`（repojacking 检测——账号删除后用户名可被重注册，`owner/repo` URL 指向新代码）。

### SEC-2 比对规则 → redFlag → 人审（复用 quarantine 模型）

| 信号 | 检测 | 覆盖 |
|---|---|---|
| `time.created > firstSeenAt` | 包被重建 | 无 scope 名抢注 |
| maintainers/_npmUser 变更 | 发布者换人 | 劫持（部分）、合法转让（灰） |
| repo `id` 变化 | 仓库被重建 | repojacking |
| `dist-tags.latest` 倒退 | 版本回滚/撤销 | 紧急撤恶版 or 异常 |
| `removed.lastSource` vs 复活者 | 名字复用 | 消失后换人复活 |

注意：抢注者可把 repository 指回原 repo 做连续性伪装——**repo 不变不是清白证据**，publisher/createdAt 才是。

### SEC-3 delta 扫描（metadata 失效后的真防线）

绝对规则只查"有没有"postinstall/网络/混淆；劫持指纹是**新版相比旧版【新增】**危险行为——两年没 postinstall 的插件突然出现 install 脚本。merge 阶段用旧条目 capabilities 与新 scan 做差集入 redFlag。**这是 metadata 比对全穿透时的唯一防线**。

### SEC-3.5 delta 扫描的误报分层 + verified 降级语义

- 差集要分级：**新增 postinstall = 强 flag**（劫持指纹），**新增 network-call = 弱 flag**（新版正常加功能也会触发）——一锅端会淹没人审队列。
- **红 flag 必须能降级已 verified 条目**：delta/比对在已验证条目上命中时，`verification.status` 要退回 `skipped`/quarantined 并在站点显式告警——否则"verified 之后被劫持"的条目继续戴章，比未验证更危险。
- 牵连：扫描规则升级（I-5）触发重扫出新 flag 时同样走降级路径。

### SEC-4 前置：存量回填

线上 496 条无 createdAt/repo.id/maintainers 历史，部署比对前跑一次回填 pass，否则首轮全盲/误报。

### SEC-5 verify 的诚实定位

沙箱验证只证"装得上加载通"，对 metadata/delta 都穿透的恶意件无能为力——不防"是坏人"。verified 徽章语义边界要在外部话术里说清（AGENTS.md：没扫到≠安全）。

---

## 六、Workflow 层（catalog.yml/verify.yml 本身的问题）

**结论先行：修完仍是 4 个 yml，0 新增——权限/超时/矩阵都是 job 级，隔离在文件内部就能实现，不需要拆文件。唯一例外是规模化的 pending worker（S-2），届时 +1 个 `worker.yml`。**

### WF-1（严重）旧索引读取失败 = 静默清空全部历史

`git show origin/catalog:index.json > /tmp/old-index.json 2>/dev/null || echo 'no old index'`——git show 失败时 `/tmp/old-index.json` 已被重定向建成**空文件** → `loadOldIndex` 解析空串 → null → `mergeEntries(fresh, null)` 全当新条目 → `corruptionGate` 因 `!old` 放行 → **发布成功但 496 条 firstSeenAt 全重置 + verification 全丢**。一次 fetch 抖动 = 全量失忆且显示绿勾。
修法：catalog 分支存在但 index 读不出 → 直接 fail run。fallback 只在"分支尚不存在的首跑"合法。

### WF-2 race 窗口 = 整个管线时长

`git fetch origin catalog` 在 job 开头，push 在 ~30-60min 后——用的是开头快照。修法：commit 步骤内重 fetch + `pull --rebase` 重试环。配合 I-4 的共享 concurrency group。

**remerge 信任语义（已实现，备忘）**：竞态重试时 `pipeline/remerge.ts` 把"我们刚扫的新鲜数据"merge 进"远端较新状态"——**远端在 verification/removed 上是权威**（它可能刚被 verify.yml 写过），我们赢在 scan/firstSeen 字段。隐含假设：catalog 分支是 append-only 且每个 writer 都先读最新远端。如果远端某次 verify merge 本身是错的，我们会信任并保留它——可接受的取舍（错误来源会被记在那次 run 的日志/issue 里），但要意识到"远端永远赢"意味着远端一旦写入坏状态，后续 merge 会继承它而非自愈。

### WF-3 权限最小化未对齐自家标准

verify.yml 做对了（跑不可信代码的 job `permissions: {}`），catalog.yml 却把 `contents:write+pages:write` 的 token 传给处理不可信 npm 元数据的 run.ts。修法：拆 **generate job（`permissions: {}`，跑管线产 index+site 存 artifact）→ publish job（写权限，只干 commit/push/deploy）**——同文件两 job，不需要拆 yml。

### WF-4 catalog 2次/日 vs verify 1次/日 错位

11:00 UTC 趟的新条目等 ~18h 才验证。修法：verify cron 对齐两趟，或第二趟 catalog 改 metrics-only。

### WF-5 site 构建故障阻塞数据发布

site build 在 push 前——构建挂了数据也不落。修法：site 拆独立 job `needs: publish`，数据先落库，门面失败单独重试。

### WF-6 失败无告警

schedule 跑挂只有 UI 红点。修法：各 workflow 加 `if: failure()` step 自动开 issue（顺手也覆盖 cron 被 GitHub 静默跳跑的场景——配 staleness 检查：index.generatedAt 超过阈值告警）。

### 目标结构（近期）

```yaml
catalog.yml
  generate:    permissions:{} → 跑管线 + build site → artifacts(index.json, site)
  publish:     contents:write → fetch+rebase+commit catalog 分支
  site:        pages/id-token:write, needs:[generate,publish] → deploy-pages
verify.yml     (同上结构已接近，cron 对齐 + concurrency 并入 catalog-branch)
submit.yml     + approved → 写 seed 到 catalog 分支
ci.yml         不动
# 规模化后（S-2 阶段）：
worker.yml     hourly, permissions:{} + publish job → 按 hash(name) 消化 pending.json
```

---

## 七、残余盲区（B 系列）

### B-1 无人工下架/拉黑机制（机制缺口）

全管线自动收录，确认恶意/作者要求/DMCA 时**没有移除手段**——delta 扫描只防"新版变恶"，"已验证版本本身就是恶意、事后实锤"束手无策。修法：`catalog` 分支加 `blocklist.json`（name/slug + 原因 + 时间），planner/merge 强制剔除并落 `removed.reason: manual`——人工闸优先级高于一切自动判定。

### B-2 ANSI/控制字符注入：index.json 对 TUI 消费者不可信

site 的 `esc()` 防住 HTML/XSS，但 **market 插件是 TUI**——恶意包 description 塞 ANSI/OSC 转义序列，index 原样传递，终端渲染即被操纵（清屏/伪造输出/恶意超链接）。数据层不该剥控制字符（原始数据是资产），**清洗责任在消费端**：market 插件渲染一切外部字符串前过 sanitize。推论写死进文档：**index.json 对所有消费者都是原始不可信输入**。

### B-3 schema 演进无策略

`"version": "1"` 字面量。定规则：v1 内只允许 additive（加字段），改/删字段必须 `"version": "2"` 并行发布——否则下游消费者被静默打断。

### B-4 verify 沙箱网络出口未关

`permissions:{}` + 无 secrets 做对了，但 runner 外网全通——无 postinstall 的恶意插件激活瞬间可外联/拉 payload（network-call 是 finding 非 redFlag，照样被激活）。修法：verify job 网络出口白名单（npm/GH registry），或激活阶段断网。

### B-5 Pages 部署 last-writer-wins

catalog 和 verify 都 deploy 同一站点；verify 用它开跑时拉的旧 index 建 site——若其 deploy 在 catalog 之后落地，站点回退旧数据。修法：site job 永远从 catalog 分支**当前** index 构建，不用 run 开头快照。

### B-6 metrics 可刷分

stars/下载可买可刷——metrics 只作事实展示，不进排序/信任权重；或加反操纵启发（stars/下载比异常检测）。

### B-7 消费端无降级 + index 完整性

market 插件拉 index 失败应有 last-good 缓存兜底而非白板；长期可给 index.json 配 checksum/签名供消费者校验。

---

## 八、优先级（依赖序）

```
第一梯队 正确性止血（纯代码/配置，无迁移）：
  WF-1 索引丢失硬失败 → I-2 merge 两层 key → I-1 slug 唯一性+存量修复 → I-5 ruleset 版本 → I-3
  （WF-2/WF-3/WF-5/WF-6 + I-4 是 workflow 层改动，量小顺手修，不占梯队）

第二梯队 流程兑现：
  排序确定化+cap → D-2 submit 持久化 → D-1 ghList 决策 → B-1 blocklist → B-2 消费端 sanitize

第三梯队 失效与安全（依赖 #9 字段先落盘）：
  SEC-1 字段落盘 → SEC-4 回填 → SEC-2 比对规则 → F-2 removed 段 → SEC-3 delta 扫描
  （B-4 verify 断网、B-5 site 构建改 fetch 当前 index 并进本梯队顺手修）

第四梯队 规模化（等真涨上来）：
  S-2 planner/pending 队列 → verify 容量
```

**依赖链**：SEC-1 必须在 SEC-2 前（无字段无比对）；I-2 必须在 F-2 前（tombstone 靠稳定身份键追踪消失/复活）；排序确定化必须在 cap 提高前（否则放大 flap）。

**紧迫度排序**：I-2、I-1 是每日真实损失（每版丢数据、线上撞车）；SEC-* 是"信任"卖点的护城河（漏检抢注还盖章是信任自杀）；S-2 是产能工程，未到万级不急。

---

## 附：验证记录

- slug 撞车实证：`git show origin/catalog:index.json` 496 条，dupe slug 15+
- ghList 死代码：`pipeline/run.ts:60-77`，queue 仅含 npmList
- submit 无下游：`.github/workflows/submit.yml` 全文无 index/seed 写入
- packument 未存字段：`pipeline/fetch/npm.ts:17-56`，Packument 接口无 createdAt/maintainers/dist-tags
- 条目字段全集：`name slug aliases type discoveredVia source description category license deprecated replacement firstSeenAt latestVersion publishedAt metrics capabilities verification compat contains`
- GH token 限速：docs.github.com REST rate limits——`GITHUB_TOKEN` 1000/hr/repo，search API 30/min
- 双写竞争：verify.yml merge job 与 catalog.yml 同样 `checkout -B catalog` + push，concurrency group 不同
- 规则无版本：`pipeline/scan/rules.ts` RULES 数组无版本标识
- `.opencode-market.json`：DEV.md §元数据约定 vs `grep -rn "opencode-market.json" pipeline/ src/` 零命中

---

## 附二：实现状态（2026-11 本轮开发）

| 项 | 状态 | 落点 |
|---|---|---|
| I-1 slug 唯一 | ✅ | `merge.ts dedupeSlugs()`：撞车者改 slug=npm 名，旧 slug 入 aliases；存量撞车条目下一轮自动愈合 |
| I-2 merge 两层 key | ✅ | `mergeEntries`：身份字段按 name、per-version 按 name@version+host+ruleset |
| I-3 categories union | ✅ | `buildIndex`：旧注册表 ∪ 实际使用 id |
| I-4 双写竞争 | ✅ | 三个 workflow 共用 `concurrency: catalog-branch` |
| I-5 规则版本 | ✅ | `RULESET_VERSION='r2'` 入 capabilities + 缓存键 + delta gating |
| F-1 排序确定+cap | ✅ | admitted 按 name asc 排序后 slice（npm search 无下载量字段，name 是唯一确定性键）；`--max 2000` |
| F-2 removed 段 | ✅ | `RemovedEntry{slug,name,lastSource,disappearedAt,reason}`；transient error **保留旧条目不写墓碑** |
| S-1 增量短路 | ✅ | name@version+ruleset 未变整条复用；>7d stale 滚动刷新 deprecated/maintainers/distTags/metrics/repoId |
| S-2 pending 队列 | ⏸ 后置 | 按设计等条目真涨上来再做（需 worker.yml+pending.json 协议） |
| D-1 ghList 接线 | ✅ | github-topic 候选生成 `source.kind:'github'` 条目（verification skipped——无 npm 安装路径） |
| D-2 submit→seed | ✅ | submit.yml `ingest` job：verdict=clean → append `submissions.txt`@catalog 分支；catalog.yml `--seed` 消费 |
| D-3 死字段 | ✅/⏸ | aliases/replacement 已填（dedupe+deprecation 解析）；`compat` 保留待多版本验证（B-3 additive 规则不删字段） |
| D-4 .opencode-market.json | ✅ | `fetchMarketMeta` 读 repo 根元数据文件，覆盖 description/category |
| SEC-1 字段落盘 | ✅ | createdAt/modifiedAt/maintainers/deprecatedMessage/distTags + repo 数字 id |
| SEC-2 身份比对 | ✅ | `trustFlags`：name-reused/repo-recreated/version-rollback → redFlag；maintainer-changed → finding（灰） |
| SEC-3 delta 扫描 | ✅ | 同 ruleset 下新增 findings；lifecycle/prepare → redFlag（强），其余 → finding（弱）；**新 redFlag 把 verified 降级 skipped** |
| SEC-4 回填 | ✅ | `pipeline/backfill.ts`：一次性给存量条目补 createdAt/maintainers/repoId |
| WF-1 silent amnesia | ✅ | catalog 分支存在但 index 读不出 → 硬失败 |
| WF-2 假重试 | ✅ | publish/verify merge 都在重试环内对新鲜远端**重新 merge**（`pipeline/remerge.ts`），不覆盖对方写入 |
| WF-3 权限拆分 | ✅ | generate `permissions:{}` → publish 写 → site 部署 |
| WF-4 verify 2x/日 | ✅ | cron 04:47/16:47 UTC |
| WF-5 site 解耦 | ✅ | site job 从 catalog 分支当前 index 构建（不吃旧 artifact） |
| WF-6 失败告警 | ✅ | catalog+verify 各有 alert job 开 `pipeline-alert` issue |
| B-1 kill switch | ✅ | `blocklist.json`@catalog 分支（names/slugs）→ `removed.reason:'manual'` |
| B-2 消费端 sanitize | ✅ | `plugins/market/src/catalog.ts` `sanitize()`/`sanitizeIndex()`：剥 ANSI/OSC/C0-C1 |
| B-3 schema additive | ✅ | 新字段全部带 `.default()`；旧 index 无新字段照常解析 |
| B-4 verify 断网 | ✅ | `step-security/harden-runner` egress 白名单（npm/api.github/GitHub CDN），覆盖 install+activation 两阶段 |
| B-5 site fresh | ✅ | 同 WF-5 |
| B-6 metrics 排序 | ✅ | cap 排序键为 name asc（确定性），metrics 仅展示不进权重 |
| B-7 last-good | ✅（存量） | `fetchIndexCached` TTL+snapshot fallback 已存在 |

**存量测试**：新增 `test/sec.test.ts` 21 例覆盖 SEC 比对/delta 分级/降级/slug 愈合/tombstone/sanitize/gone-check 三分支。

**遗留（非本轮范围）**：gui.ts/spec.ts/gui-mount/contract 的存量 typecheck 错误；`test/dbg.test.ts` 未追踪调试文件（solid-js 未装）。

---

## 附三：第二轮审计修复（2026-11 审计项 N-1…N-21）

用户面 bug：

| 项 | 状态 | 落点 |
|---|---|---|
| N-1 verifyActivation macOS 隔离失效 | ✅ | `plugins/market/src/gui.ts`：`HOME` 连同全部 XDG 指到临时目录；且改为按 `pinSpec(e)` 测批准版本（不再测 dist-tags.latest） |
| N-3 TUI skill 安装无体积上限 | ✅ | `skill-install.ts`：`installSkillTar` 压缩+解压双上限（48MB/192MB）、longname/pax/ustar prefix、foreign-dir 防误删；`tui.tsx` fetch 加压缩上限 |
| N-8 pinSpec VER_SAFE 回退裸名 | ✅ | `catalog.ts`：非法版本抛错而非回退裸名（裸名装的是未批准 latest = hold 旁路） |
| N-9 Node 侧目录缓存失效 | ✅ | `catalog.ts`：无 localStorage 时回落模块级 `memIdx`，TTL+快照语义不变；backend 每次调用时探测（不再模块加载绑死） |
| N-14 GUI document click 泄漏 | ✅ | `gui.ts`：handler 自检 `menu.isConnected`，面板销毁后第一次点击自摘 |
| N-20 site findings/redFlags 未收起 | ✅ | `site/build.ts`：findings + 失败日志进 `<details>`，red flag 行打标 |

Pipeline/CI 安全：

| 项 | 状态 | 落点 |
|---|---|---|
| N-2 checkGuiBundle 进程内执行+无超时 | ✅ | `verify/gui.ts`：换 `node:vm` 独立 realm（无 process/require/import()），eval 5s/stage 8s 超时；`verify.ts`：unhandledRejection 兜底 + 逐目标 try/catch + 增量写结果 |
| N-4 buildSkillCatalog shell 拼接 | ✅ | `site/build.ts`：`execFileSync` 数组参数（npm view/curl/tar），tarball URL 限 https（默认实现内），`find` 换 Node 遍历，失败清临时目录 |
| N-5 github-kind pending 死路 | ✅ | `docket.ts`：repo-only pending 无 verdict 时建 standing `[review]` issue（verdict:'none'，无 ai: 标签）；`digest.ts` held 列表标注 repo-only；`notify-published.ts` seed 按 `repo` 匹配 |
| N-6 submit review 权限未拆 | ✅ | `submit.yml`：review job 降 `permissions:{}`（解析攻击者 tarball 零 token），report job（`issues:write`）只读 artifact 发评论/标签 |
| N-7 scan 解压+findings 上限 | ✅ | `scan.ts`：累计解压 >512MB `parser.abort`（防 zip bomb）；findings 上限 500 + `scan-capped` 标记 |
| N-10 verify merge 依赖整矩阵 | ✅ | `verify.yml`：results 上传 `if: always()`；merge `if: always()` 收部分结果（取消/skipped 除外） |
| N-11 规则缺口 | ✅ | `rules.ts`：RULESET_VERSION `r2→r3`；lifecycle 补 prepublish/prepublishOnly/prepack/postpack/install；私有 IPv4+IPv6 豁免（loopback/link-local/ULA/multicast/doc 段，v6 须含 hex 字母）；`atob`/大 base64 拆为 medium `base64-blob` |
| N-21 shard 超时余量 | ✅ | `verify.yml` timeout 20→30min（12 目标串行 ~15min 最坏） |

流程/整洁：

| 项 | 状态 | 落点 |
|---|---|---|
| N-12 搜索只查英文 + source 未 sanitize | ✅ | `catalog.ts`：`search()` 覆盖 en+zh 描述；`source.kind/id/repo/version` 已在 sanitizeIndex 范围内 |
| N-13 测试类型 `ctx as never` | ✅ | `test/helpers/mount.ts` 返回结构类型；`gui-mount.test.ts` setup 调用处显式 cast |
| N-15/16 死代码+死资源 | ✅ | 删 `sel`/`dedupeSpecs`/`looksLikePlugin`（测试改测 `dedupeToSpec`）；`plugins/market/index.json` 760KB 过期快照从 `files` 移除并删除 |
| N-17 spike.yml on:push | ✅ | 改 `workflow_dispatch` only（每次 push 烧 15min runner+模型调用） |
| N-18 非 maintainer [concern] 无人管 | ✅ | `concern.yml` 新增 `triage` job：非 maintainer 开的 [concern] issue → 说明 + 关闭 |
| N-19 skill tar 解析 | ✅ | 同 N-3（`installSkillTar` 重写：L/x/ustar-prefix、大小上限、撞名安全删） |

**顺带修复**：
- `test/*` 全部 ruleset fixture `'r2'`→`RULESET_VERSION`（r3 bump 暴露的测试脆弱点——fixture 本意是"当前规则集"）
- `plugins/market/test/market.test.ts` 外网依赖改本地 http server（undici 不读 HTTPS_PROXY，直连挂代理环境必挂）
- `re-features.ts` 重构为 `main(file,{dry,fetchFn})`（原顶层执行不可测，0%→65% 分支）

**仍开（有意保留/后续）**：S-2 pending 队列（未到规模）、D-4 `.opencode-market.json` 已有 fetchMarketMeta 半实现（repo 根约定文件），B-7 index checksum 签名（last-good 缓存已有）、uninstall 两步确认（产品判断：可重装≈可撤销）、verifyShard unhandledRejection 仍存理论残余（进程内 vm 的 fire-and-forget 侧信道——已有进程级兜底）。

**验证**：`npx tsc --noEmit` 0 错；`npx vitest run` 427 全过；`npm run coverage` statements 98.0% / branches 90.1% / functions 96.3% / lines 99.2%（90% 门槛全过）。

---

## 附四：抓取链路审计（F-1…F-14，2026-11-04 实现）

对 discover/fetch/run 消费段的第三轮审计，全部修复：

| 项 | 状态 | 落点 |
|---|---|---|
| F-1 github-kind 缺失条目不重探直接 tombstone | ✅ | `run.ts` goneCheck：github-kind 也 `fetchRepoMeta` 重探，`error`/`rate-limited` → 保留（与 npm 侧对称）；`schema.ts` RemovedReason 增 `repo-404` |
| F-2 `repository.directory` 路径穿越绕过 repo-mismatch | ✅ | `fetch/github.ts` `fetchRepoPackageName` 拒绝含 `..`/`.` 段的 dir（不发请求）；`run.ts` 打 `sec:repo-dir-traversal` finding |
| F-3 `looksLikeTemplateSpam` 误伤 `opencode-*` 前缀 | ✅ | `filter.ts`：stem 判定从 `slice(0,6)` 前缀改全 stem 相同才计票——`opencode-weather/git/…` 不再误伤，`mp-x1…x6` 仍能抓 |
| F-4 github 侧无 cap | ✅ | `run.ts`：ghList 按 fullName 排序 + `maxEntries` 截断，seed repo 免 cap，被截者进 `cappedOut` → `capped` tombstone |
| F-5 seed `repo` 字段 dead-wired | ✅ | `normalizeRepoUrl` 接受裸 `owner/repo`；`run.ts` declaredRepo 作 packument repository 的 fallback，二者不一致打 `sec:repo-declared-mismatch:<repo>`（仅对 submission 候选，organic 搜索同源字段不比较） |
| F-6 已发现 npm 投稿不标 submission | ✅ | `run.ts`：已在 npmCands 的投稿 merge `submission` 进 discoveredVia |
| F-7 secondary rate limit 归 error | ✅ | `fetch/github.ts` rateLimited() 增 `403 + retry-after` 判定 |
| F-8 tree `truncated` 忽略 | ✅ | `RepoTreeResult.truncated` 透出；`run.ts` 截断时 warn（深层 .opencode/skills 探针可能漏） |
| F-9 `.opencode-market.json` 无体积上限 | ✅ | `fetchMarketMeta`：category ≤8 项每项 ≤80 字符，description ≤4000 字符 |
| F-10 `a/b.git/` 尾斜杠残留 | ✅ | `normalizeRepoUrl`：match 后再 strip `.git`（同时覆盖 bare `.git` 尾） |
| F-11 repoToNpm 只探 main/master | ✅ | `seed.ts`：filterByStars 带出 `default_branch`，repoToNpm 优先探之再回退 main/master |
| F-12 github-kind `verification:'skipped'` 语义失真 | ⏪ 回滚 | 初判改 `'unverified'` 是回归：verdicts.ts `RELEASABLE` 只收 verified+skipped，'unverified' 让 repo-only 条目永远无法被人工 pass 释放；且 site/GUI/TUI 已对 `latestVersion===null` 特判渲染 "nothing to install/没有可安装的包"，诚实标签在展示层已解决 |
| F-13 `fetchTarball` 不校验 scheme | ✅ | `fetch/npm.ts`：tarballUrl 限 `https:`，malformed 拒绝 |
| F-14 `!pk` 合并 not-found/error | ✅ | `run.ts`：`status==='error'` 且有 prev → 保留旧条目（不再落 goneCheck 二次拉取）；seed 投稿瞬时失败打 warn |
| 附：packument/repoMeta `res.json()` 在 try 外 | ✅ | malformed JSON body → `status:'error'` 而非 unhandled throw 杀 run |

新增 `test/fetch-audit.test.ts`（17 用例）覆盖全部新分支。

---

## 附五：投稿→发表全链路审计（P 系列，2026-11-04）

| 项 | 状态 | 落点 |
|---|---|---|
| P-1 diagnose/digest 依赖维护者本机 launchd 无监控 | ✅(digest 半) | 新增 `.github/workflows/digest.yml`：digest 搬回 Actions（cron 21:15 UTC + dispatch，`contents:write` 单 job，worktree 渲染 + race 重渲染重试）；`watchdog` job：ai-verdicts.jsonl >48h 未更新且仍有 unreviewed 目标 → pipeline-alert issue（去重）；`alert` job 兜底。本机 `bin/publish-digest.sh` 留作手动兜底 |
| P-3 AI 评审物料只含扫描结果不含代码 | 📝 已知限制 | `reviewMaterial` = manifest + findings + redFlags + 版本行——"AI 评审"实为扫描器输出的二次分类器；真实安全来自 verify 沙箱实装 |
| P-4 `MARKET_REPO_URL` 旧仓库名 | ✅ | `digest.ts` 工作流经 `MARKET_REPO_URL=${{ github.server_url }}/${{ github.repository }}` 自适应改名；`bin/publish-digest.sh` 默认更新 |
| P-4b 全部 `opencode-market-spike` 引用 | ✅ | `catalog.ts`/`gui.ts`/`tui.tsx` 默认 Pages URL、`site/build.ts` footer、`publish-digest.sh` 全部改 `awesome-opencode-market`（旧 Pages URL 改名后仍 200 服务，无断链） |
| P-5 notified 推送 `|| true` 可双评论 | 仍开 | catalog.yml:111——下次再议 |
| P-6 repo-only 投稿无人工闸前自动 ingest | 仍开 | 设计权衡：人工闸在 docket 端，spam 只制造 review issue 噪音 |
| P-2 F-12 回归 | ⏪ 已回滚 | 见附四——本轮审计自抓 |

**验证**：`npm run check` 449 tests 全过，branches 90.69%。

---

## 附六：verify.yml 数据流审计（V 系列，2026-11-04）

| 项 | 状态 | 落点 |
|---|---|---|
| V-1 verify 结果无完整性保护——被验证的恶意包可伪造自己的 `verified` | ✅ | **uid 隔离**（优于 HMAC——env secret 会被同 uid 进程经 `/proc/<pid>/environ` 读到）：`sandboxUser` 模式下 `<home>/u` 归 nobody，所有执行不可信代码的命令（`plugin add`/`serve`/`tmux`/gui 检查）经 `sudo -n -u nobody env …` wrapper 运行；`results-N.json` 归 runner uid 且 `/tmp` sticky——插件既不能覆写结果也读不到 shard env。`verify.yml` 前置 `sudo -n -u nobody true` 硬闸，job 不会静默降级（本机 dev 探测失败才降级 + warn） |
| V-1b 日志 canary 可伪造 | ✅ | 插件代码可往 opencode.log 追加 `loading plugin id=…` 行→旧 canary 必假阳性。改 `/api/plugin` 服务端应答：`source.type==='package' && target` 匹配安装 spec && `state.status==='active'`（`apiLoaded`，深遍历容忍响应包裹层）。`loadedSignal` 降级为 excerpt 诊断 |
| V-1c gui 检查在 shard 进程内跑不可信代码 | ✅ | sandbox 模式下 `checkGuiBundle` 移到 `npx tsx gui.ts <bundle>` nobody 子进程——vm realm 逃逸也只拿到 nobody，写不了 results、读不到 shard env |
| V-2 吞吐 96/天 硬编码无积压观测 | ✅ | digest 新增「④ 验证积压」段：队列长度（同 planTargets 谓词）/投稿数/近7天失败数/最老等待日期；`verify.yml` dispatch 加 `cap` input → `VERIFY_CAP` 环境变量 → plan.ts 可调上限冲积压 |
| V-3 `failed` 终态不分暂态/确定性，唯一重试是手动 --retest | ✅ | `Verification.retries` 字段记录连续失败次数（merge 写回递增、非 failed 清零）；plan `retryable()`：`failed && verifiedAt<7d && retries<3` 自动重入队列——真死版本 3 次尝试后仍终态，canary 误杀自愈；red-flagged 依然永不执行 |
| V-4 canary 时序赌博（12s 窗口）是 V-3 误杀主源 | ✅ | 窗口 12s→20s；`apiPluginState`/`apiFailed` 区分确定性失败（serve 报 `failed` → 条目一出现就跳出，~1s 判死）vs 超时缺席——`logExcerpt` 写明死因供人工抽查；残余 flake 由 V-3 自动重试吸收 |
| V-5 单版本测试（cli@2.2.5），`compat:{}` 死字段 | 仍开 | 多版本矩阵才有"兼容"语义 |
| V-6 rpc/skill/mcp/theme 等类型无验证层级 | 仍开 | 仅 server/tui/gui 有深度路由 |
| V-8 merge 在 verify.yml 里顺带重建+发布 site，与 catalog.yml site job 双发布者 | ✅ | site 发布抽成独立 `site.yml`（唯一 Pages 发布者，bot push 不触发 `on:push` 故走 dispatch）；catalog publish 与 verify merge 推送后 `gh workflow run site.yml`（各加 `actions:write`，merge 去掉 pages/id-token）——验证标签即时上站且不再双写 |

**验证**：typecheck 0 错；500 tests 全过；branches 90.62%。`RESULTS_HMAC` secret 未使用——uid 隔离后 secret 前提不成立，已可删除。

## 附七：AI 诊断链审计（D-1…D-8）

`bin/ai-diagnose.sh`（launchd 每小时）→ `diagnose.ts`（sha复用→verify短路→L0.5→ornith）→ ai-verdicts.jsonl → `applyMatureVerdicts`。

|---|---|---|
| D-1 omlx 死透烧满 45min 预算（每候选 5min 超时串行） | ✅ | `omlxAlive` 探活：main 在 LLM 候选存在时先 `GET /models`（任何 HTTP 响应算活，连接失败才算死）；死 → 免费 verdict（sha复用/verify短路）照写、LLM 候选留 held、flagged/L0.5 兜底 concern 照出 |
| D-2 drift 检查每条 pending 已判条目一次 `npm view` 且 works 重复查 | ✅ 部分 | `shaFor` 缓存：drift sweep 与 works 共享 `name\0ver` 单查（消除重复）；保留同步 `integrityOf` 实现（并行 WIP 已定其 API+测试契约），批量 fetch 留作后续 |
| D-3 恒败候选每小时白烧一次 LLM 无上限 | ✅ | `--state` 持久化连续失败计数（本地文件，不进共享 schema）；真实 LLM 失败才计数（探活跳过不算）；≥5 次 → 写「工具故障非安全结论」concern（停止烧 token + 人类可见 + `--force` 可重审）；成功清零 |
| D-4 launchd 不防重入 + 日志无轮转 | ✅ | `mkdir` 原子锁（macOS 无 flock）+ 拿锁后立即挂 EXIT trap（早退不死锁）；日志 >5MB 截尾 1MB |
| D-5 `integrityOf` 失败 → verdict 裸奔无 drift 保护 | 部分 | registry 抖动概率低且 npm 重发本就罕见——维持「降级不阻塞」，D-2 的 dedup 顺带降了失败面 |
| D-6 `--limit` 默认 Infinity 会把全积压塞进 LLM | ✅ | 默认改 50（与脚本一致） |
| D-7 诊断积压无观测面（watchdog 只管死活不管快慢） | ✅ | digest「⑤ 评审积压」段：待评审 N / 近 24h 新判 X / 最老待审日期 |
| D-8 heldAt 缺失 → NaN → 立即审不 defer | 确认 | fail-open 方向只浪费一次 token，安全语义不变 |
| ⚠️ 审计中差点误报：`verify` 块跳 L0.5 看似漏掉攻击者文本 | 非问题 | logExcerpt 只在 verification failed 时有值，而 failed 走短路不到 LLM；真正含自由文本的块（manifest/finding/flag/prev-findings）全部打分 |

**验证**：typecheck 0 错；508 tests 全过；branches 90.43%；新增 `test/diagnose-ops.test.ts` 8 用例。

## 附八：放行链审计（R 系列，applyMatureVerdicts 全流程）

`run.ts` 前置 `applyMatureVerdicts`（旧索引 → verdict 应用 → discovery 对比）→ worker hold-by-default → `buildIndex`/`mergeEntries` → publish `remerge` → `site.yml` dispatch；`concern.yml` 人工 verdict 写 `ai-verdicts.jsonl`。

已确认正确：promotion 在 rebase race 下不丢（`prev.pendingUpdate.version === out.latestVersion` → hold 不复活）；verify-merge 的更新鲜 verification 在 remerge 盖陈旧值；`skipIfFlagged` 兜底诚实标签；concern 双向幂等（reason 不变不重注）。

| 项 | 状态 | 落点 |
|---|---|---|
| R-1 pendingUpdate 追新 = 热点包评审饥饿 | ✅ | pin-until-terminal（`run.ts` worker 前置）：held 版本未终态就钉住不追新——终态=held 版 verdict 为 concern 或 verification failed 且 `retryable` 耗尽；`pk.latest` 上有 human verdict 时人工跳车重定向。pin 路径只刷新 registry 元数据（distTags/repoId/metrics，repojack 检测保留），tarball 拉取+扫描+repo 证据探针全跳过。顺带修复：ruleset 升级曾团灭所有在飞 hold（短路失配→整槽重建→verification/heldAt 清零），现整体带过。上游最新版由 `distTags.latest` 承载，schema 零改动。放行节奏：每 catalog run 至少前进一版（原语义下可能永远不动） |
| R-2 concern「立即生效」实为下个 catalog run（~16h 窗口） | ✅ | `concern.yml` append 步骤改 worktree 模式（保 main pipeline 代码），新增 `npm ci` + `pipeline/release.ts`（remerge.ts 同款薄 CLI，复用 `applyMatureVerdicts`）——verdict 行与 index.json 应用同 commit 落地，人工刹车真实生效；apply 失败时降级只落 verdict 行（审计日志优先） |
| R-3 pending 重建无条件洗 concern reason 为 `awaiting-review` | ✅ | `run.ts` 收窄到 `pk.latest !== prev.latestVersion` 才重置——同版本重建（ruleset 升级）保留人工注解，消除 index diff 抖动 |
| R-4 verdict 时序只按 `at` 排序，时钟漂移可让 ai pass 顶掉 human concern | ✅ | `applyMatureVerdicts` 新增 human-stickiness：`effective()`——ai 'pass' 遇同 key 最新 human 'concern' 时以 human 判词为准，只有更新的 human verdict 能解刹；ai 'concern' 仍可压过 human pass（保守方向保持开放）。digest 侧已由并行 WIP 升级为 `announced` 集合成员制（晚推的旧 `at` verdict 不再偷渡成熟） |
| R-5 displayed-concern 每次 run 都推 held | 非问题 | approval 翻 pending 后下一 run 走 pending 分支，reason 不变不重推——只计状态迁移一次 |
| R-6 pass 最小延迟 ≈1-3 天（verify→48h defer→digest→catalog） | 确认 | digest 公示窗的设计代价，非缺陷 |

**验证**：typecheck 0 错；530 tests 全过；branches 90.31%；concern.yml YAML 校验过；approval.test.ts +10 用例（stickiness 三态、人工解刹、held 槽位、pin 五态、repojack 存活）。

## 附九：人工裁决流审计（H 系列，concern.yml 全流程）

通道：`[review]` 标签 / 裸评论、任意 issue ARG 评论、`[concern]` 表单 → `ai-verdicts.jsonl`（catalog 分支）→ `applyMatureVerdicts`（human concern 立即、human pass 过 digest 公示 + verify 闸）→ docket 关单。确认正确：actor gate 补 `labeled` 无 labeler association 的洞、per-issue 并发组不丢突发、表单 dropdown 默认 concern、非 maintainer 有 triage 回音、`[submit]` 标题分诊无双写。

| 项 | 状态 | 落点 |
|---|---|---|
| H-1 留空 ver 解析 registry-latest ≠ 评审目标（热点包漂移） | ✅ | 版本解析改 index-first：`pendingUpdate.version ?? latestVersion`（在押/展示版才是裁决对象）；显式 `name@ver` 参数仍可用 |
| H-2 npm 条目 ver 解析失败 → `name\0` 死 verdict 假成功 | ✅ | index-first 兜底后仍无版本（且非 repo 名）→ 评论说明 + 不写 verdict |
| H-3 `git commit \|\| PUSHED=1` 假成功 + 假失败重推产生重复行 | ✅ | 新 `bin/catalog-append.sh`：`git diff --cached --quiet` 预判区分「真无变更」与 commit 失败；`grep -qxF` 整行去重防假失败双写。concern verdict、submit verdict、submit ingest 三处循环全部收编 |
| H-4 ARG 参数覆盖标题目标且关错单 | ✅ | 有标题目标时，跨目标裁决需 `@`/`/` 显式 spec 形态（裸词一律按理由，修掉 `/concern steals data` 误当包名）；spec 与标题不一致 → verdict 落参数目标 + 评论说明 + **不关单** |
| H-5 bot 打的 verdict 标签当真人工 | ✅ | `if` 补 `github.event.sender.login != 'github-actions[bot]'`（与 submit.yml 对齐） |
| H-6 gate 瞬断假拒绝（撤 maintainer 标签+发拒绝评论） | ✅ | gh api 重试一次；404/明确低权限才撤标签，仍失败则保留标签+提示重试（两处 gate 同修） |
| H-7 多行 reason 写坏 `$GITHUB_OUTPUT` | ✅ | 解析层 `oneLine` 折叠全部空白 |
| H-8 表单字段 `[^#]+` 遇 `#` 截断（C#、issue 引用） | ✅ | 解析改用 `submission.ts` 导出的 `sections()`（`###` 标题切分，`#` 值内字符保留） |
| H-9 无 `pull_request` 守卫 | ✅ | `if` 顶层补 `!github.event.issue.pull_request` |
| H-10 静默 skip：裸命令落空无任何回执 | ✅ | `skip=noresolve` → 用法提示评论；`[concern]` 表单 issue 的裸命令改从表单体取包名（原来标题自由文本必落空） |
| H-11 exists 步 fetch 失败拿陈旧索引判存在性 | ✅ | fetch 失败直接退出，不在陈旧状态上下结论 |
| H-12 `issues.edited` 不触发——表单 typo 无法补救 | ✅ | `opened`/`edited` 都收（重跑以当前 body 为准；同目标同结论只是再落一条新 `at` 行，幂等无害） |
| H-13 已关 [review] issue 贴 verdict 标签仍生效 | 确认 | 保留为显式复裁通道（YAML 注释已写明），每次都要新的人工动作 |
| H-14 60 行内联解析 JS 零测试 | ✅ | 抽 `pipeline/human-verdict.ts`（`resolveVerdictEvent` 纯函数 + env→stdout CLI），25 用例覆盖三通道+歧义规则 |
| H-15 verdict 记录缺裁决人/来源单号 | ✅ | schema 加可选 `by`/`issue` 字段，两处 writer 盖 `github.actor`+issue 号 |
| H-16 push-retry 循环四份拷贝 | ✅ | `bin/catalog-append.sh` 单点实现（worktree + dedupe + APPLY_INDEX）；ai-diagnose.sh 的 TMPV 重放循环语义不同，保留专用 |
| H-17 ack 暗示 pass 即上架，实际 unverified 闸不放 | ✅ | ack 追加「当前验证：X」提示（verified/skipped 才略过）；verdict 版本 ≠ 在押 pendingUpdate 时也提示 |
| H-18 `[submit]` 单上 ARG 参数被静默忽略 | ✅ | 首词为异目标 spec（`@`/`/` 形态）→ `argignored` 输出 → ack 明示忽略原因 |

**验证**：typecheck 0 错；555 tests 全过；YAML 校验过；`test/human-verdict.test.ts` 25 用例。

## 附十：审核单流审计（K 系列，docket.yml 全流程）

链路：cron 每小时 / catalog+verify `workflow_run` / 手动 → `docketTargets`（held/待决目标，latest verdict source=ai + repo-only 'none' 常驻单）→ diff open [review] 单：缺则建、多余则关 → `concern.yml` 回写（标签/评论 → human verdict → ack 关单）。确认正确：execFileSync argv 无注入面、repo-only 兜底是唯一人工通道、create/close 幂等可重入、标题↔vkey 经 titleTarget+index-first 双重校准。

| 项 | 状态 | 落点 |
|---|---|---|
| K-1 三触发源可重叠 → 并发双建 [review] 单 | ✅ | job 级 `concurrency: review-docket`（串行不 cancel，天然可重入） |
| K-2 open 单的 `ai:*` 标签/正文冻结在创建时刻，判词翻转后显示错信息 | ✅ | 全漂移同步：`gh issue list --json labels,body` + `issueBody(t)` 确定性重建——`ai:*` 标签随当前判词换、`review:pending` 缺了补回、正文与 want 不一致即 edit（判词翻转/验证落地都会传播） |
| K-3 docket 只看原始 latest，不显示 R-4 的 human-stickiness（ai pass 压在押 human concern → 单上无刹车上下文） | ✅ | `verdicts.ts` 抽 `latestHumanVerdicts`/`effectiveVerdict` 复用；docketTargets 附 `humanVerdict` 字段，正文写「在押刹车——AI 新判 pass 不会自动放行，本单为复审」（原始 latest 仍驱动选单：复审通道刻意保留） |
| K-4 判词落在死版本上（既不在押也不展示）→ ack 暗示生效实际蒸发 | ✅ | `concern.yml` resolve 步输出 `deadslot`（V ∉ {heldver, displayed} 且非 repo）→ ack 明示「裁决已存档但没有生效槽位」 |
| K-5 `--label review:pending` 过滤漏掉手动摘标签的单 | ✅ | 改列全部 open 单后按 `[review]` 标题前缀客户端过滤——被摘标签的想要的单补回标签、不想要的照常关 |
| K-6 fork/瞬断下 cron 每小时红失败（`git fetch origin catalog` 无分支） | ✅ | fetch 失败 `exit 0` 下轮重试；prod 侧 catalog 恒在，语义不变 |
| K-7 `gh label create --force ×6` 每 run 全量重置 | 不改 | 幂等且保证新仓库自举；改存在性检查省的 API 调用不值复杂度 |

**验证**：typecheck 0 错；560 tests 全过；7 个 workflow YAML 校验过；`docket.test.ts` +5 用例（stickiness 上下文、刹车正文、标签/正文漂移重同步、摘标签补回）。

## 附十一：站点发布流审计（S 系列，site.yml + pipeline/site/build.ts）

链路：catalog/verify push 后 dispatch → `site.yml`（`site-deploy` 串行，单 Pages 发布者）→ 现取 `origin/catalog:index.json` → `build.ts` 渲染 index/list/detail/skills/privacy/health → upload-pages-artifact → deploy-pages → alert。确认正确：B-5 deploy 时取数不碰陈旧物、esc() 全覆盖包控字段、hold 语义贯彻（skill tarball pin 批准版 + pending 不渲染 + 客户端自滤）、tar 穿越经实测被工具链挡下（本项后由两段式提取根治）。

| 项 | 状态 | 落点 |
|---|---|---|
| S-1 skills 每 deploy 全量串行重建（274×npm+curl+tar，pin 版本未变也重拉） | ✅ | `<id>@<ver>` 版本pin缓存（`.skill-cache` + actions/cache 滚动键）；命中零网络，build 末 prune 失效键 |
| S-2 registry 抖动 → skills/index.json 静默 `{skills:[]}` | ✅ | `landed/candidates/degraded` 计数进 health.json + build 日志告警；degraded = 有候选但落地不足一半 |
| S-3 发布无数据闸门——坏 index 会推空目录上线 | ✅ | `healthGate(prev, cur)`：entries<200 绝对地板 或 <上次发布 50% → gate 步失败不部署；live health.json 拉不到只退绝对地板 |
| S-4 解包收 `node_modules/**/*.md`（捆绑依赖 README 泄漏进发布目录） | ✅ | 两段式提取：`tzf` 列表 → 仅按名提取 `.md` 成员（node_modules 路径段滤除） |
| S-5 tar 符号链接本体落进发布目录（死链）+ 旧 tar 的穿越假设 | ✅ | 同上——symlink 成员根本不进提取列表（任意 tar 版本都无穿越原语）；`.md` 命名 symlink 由 mdFiles `isSymbolicLink` 清扫 |
| S-6 alert job 无 dedupe——连败 issue 轰炸 | ✅ | 按 `pipeline-alert`+标题查 open issue → 评论追加而非新开（digest watchdog 同款） |
| S-7 9MB 全量 index.json 供客户端（含 pending 22%） | ✅ | 曾产 `index.lite.json` 瘦索引——无消费者后已砍（死工件会腐化）；全量 index.json 保留为审计面，客户端 `fetchIndex` 走 health.json sha 校验路径 |
| S-8 listPage 只有搜索框，无分类浏览（entry.category 字段闲置） | ✅ | category `<select>` + 组合过滤脚本（data-cats 持转义数组，`"slug"` 子串精确匹配） |
| S-9 `removed[]` 2198 条不渲染——消失插件直接 404 | ✅ | `removed.html`：disappearedAt 倒序最新 300 条（name/slug/reason/date） |
| S-10 skills 只有 JSON 无 UI | ✅ | `skills.html`：id+版本+文件链接（.md 原样可浏览）；listPage 头加 skills/removed 入口 |
| S-11 site job 缺 `contents: read` 显式权限 | ✅ | permissions 补上（public repo 匿名 fetch 碰巧可用，显式更稳） |
| S-12 id 碰撞：`@a/x`(namespaced→a--x) vs 真名 `a--x` → 目录互覆盖 | ✅ | `usedIds` 集合，碰撞追加 `-x` 确定性后缀 |
| S-13 CLI main 不校验——坏 index 崩中途（不会发半成品但报错差） | ✅ | `CatalogIndex.parse` 前置 zod 校验 |
| S-14 listPage 不渲染 `description.zh` | ✅ | 卡片+详情页补 zh 行（实测当前数据 zh=0，前瞻） |
| S-15 `version: s.latestVersion ?? '1'` 不可达代码 | ✅ | null 版本早被跳过，直接 `ver` |
| S-16 buildSite 不清理旧输出——残留文件会一起发出去 | ✅ | 开头 `rmSync(outDir)` 重建 |

**验证**：typecheck 0 错；569 tests 全过；build.ts 覆盖率 97.6%；site.yml YAML 校验过；site.test.ts +14 用例（缓存命中/种子/清理、两段式提取含 node_modules+symlink 对抗包、id 碰撞、闸门、lite 索引、removed/skills 页、分类下拉、陈旧输出清理）。

### 附十一补遗：categories 词表错配（遗留项修复）

活 index 的 `categories` 字典键是中文标签（`主题与外观: {en: 主题与外观}`），而 `entry.category` 是英文 slug（`tools`/`sessions`）——设计本意是 slug 键 + `{en,zh}` 显示名（`src/categories.ts` 的 `CAT_NAMES`）。`buildIndex` 的 I-3 归一逻辑正确，但 `remerge`（发布重试路径）裸合并 `remote.categories`，catalog 分支上的旧中文键会被原样带回来、永不迁移。

修复：`remerge` 对齐 `buildIndex`——remote/ours 两侧字典键经 `catId` 归一 + `CAT_NAMES` 回填、merged 条目的 `e.category` 值归一、按条目补齐字典项。活 index 无需手动修：下一次 catalog run 经 `buildIndex` 自愈，remerge 不再反向污染。测试：sec.test.ts +1（ours 中文值 + remote 中文键双侧归一）。

## 附十二：收录发现流审计（C/R/F 系列，catalog.yml 全流程）

链路：cron/dispatch → `generate`（零权限；old index/seed/blocklist/verdicts/digest-state 取数 → run.ts 发现+准入+扫描+hold 手术+gone-check+merge 门 → artifact）→ `publish`（worktree fetch→reset→remerge→commit→push ×4 → notify → dispatch site）→ `alert`。确认正确：WF-1/WF-2 姿态、增量复用按 held 版本比对、R-1 钉版治高频饥饿、trustFlags 双层、tarball https-only+双字节上限+tar7 abort、gone-check 只信 404 方向性 fail-closed、honest label 落盘。

| 项 | 状态 | 落点 |
|---|---|---|
| C-1 `--max 2000` 限"候选处理数"而非目录量——活跃 npm 条目 1936 逼近上限，字母序靠后老条目被系统性逐出（live 已有 949 条 capped 墓碑） | ✅ | cap 语义改为只限**新候选**：`existing` 全豁免 + `newbies.slice(newCap)`；投稿 seed 双侧豁免；超限新候选仅本轮不索引、无墓碑 |
| C-2 `commit \|\| echo "no changes"` 假成功（真失败被吞 → push no-op → 全绿没写盘） | ✅ | `git diff --cached --quiet` 预判：真无变更才走 no-op 分支，commit 失败显式进下轮重试 |
| C-3 generate（~30-60min 只读）全程占 catalog-branch 写锁——verify/digest/ingest 排队 | ✅ | 并发组移到 publish job 级；generate 无锁（多实例只读互不干扰） |
| C-4 blocklist 解析失败 fail-open——被拉黑条目静默回收录 | ✅ | present-but-corrupt → `loadBlocklist` 抛错拒跑；文件缺失才视未配置。同修法：`loadOldIndex` present-but-corrupt 也不再静默降级 null |
| C-5 alert job 无 dedupe → 连败 issue 轰炸 | ✅ | 查 `pipeline-alert` 既有 open issue → 评论追加（S-6/digest watchdog 同款） |
| C-6 notify 标记 `commit && push \|\| true`：push 失败丢 notified → 下轮重复评论 | ✅ | 标记推送 3 次重试前置；推不上不评论不关单（宁可重发不丢事实） |
| C-7 `gh workflow run site.yml \|\| echo` 吞失败 → 站点陈旧到下一班 | ✅ | dispatch 失败 10s 后重试一次，仍败只记日志 |
| R-1 `integrity` 永不回填（实测 1707/1936 npm 条目 null——复用路径不碰 SRI，装前 sha 校验空转） | ✅ | 复用短路加 `needsIntegrity` 条件 → refreshMeta 从 packument `integrityOf[latestVersion]` 回填；长尾逐轮补齐 |
| R-2 github 发现面系统性偏窄（sort=updated ×5 页 = topic 前 500；npm 侧同理截断<20% 也存在包被误标 filtered） | ✅ | 双管齐下：github 搜索 ≤10 页 + `fork:false` 服务端过滤；更根本的是 R-3——"没搜到"不再构成墓碑证据 |
| R-3 gone-check 分不清三种缺席（证据拒/搜索漏/工人崩）→ 全标 filtered 且丢身份字段 | ✅ | `rejectedNpm`/`rejectedGh` 正向拒绝集合：探活 ok 且无拒绝记录 → 保留不碑；'filtered' 只剩正向拒绝语义 |
| R-4 `agent-skill` topic + 裸 SKILL.md 算 OpenCode 特异信号——纯 Claude 技能仓库可混进目录 | ✅ | opencodeTopic 只留 `opencode-plugin`/`opencode-skill`；SKILL.md 只算产物不算归属；`.opencode/`、`opencode.json[c]`、专属 topic 三选一算特异 |
| R-5 投稿包 404 时静默——投稿人不知"包不在 npm" | ✅ | seed npm 包 not-found/error 打 warn 日志（含包名）；issue 侧由 staleWarned 14d 兜底 |
| R-6 复用短路只查 `isBlocked(name)`——slug 拉黑后老条目仍被复用 | ✅ | npm/github 双侧复用都过 `isBlocked(name, slug)` 双键 |
| R-7 模板垃圾启发静默剔除——合法 org ≥6 近名包被整体误杀且无审计 | ✅ | 垃圾 owner 名单逐个上日志（不再只打计数） |
| R-8 remerge 不对称：本地 hold、remote 已放行同版 → 重挂一轮已决 hold | ✅ | remote `latestVersion===heldVer` 且非 pending → 采纳 remote 展示态，hold 不复活 |
| R-9 `--max` 未校验 NaN/非正 → queue 空靠 20% 门兜底 | ✅ | CLI 早退校验 `--max must be a positive number` |
| F-1 tarball 成员数无上限——零字节文件炸弹撑爆 files[] | ✅ | `MAX_FILES=200_000` + `parser.abort`（可注入 `maxFiles` 参数便于测试） |
| F-2 `preAdmit` fork 检查对 gh 候选死代码（`hasOwnCommits` 恒 undefined） | ✅ | 改由 `fork:false` 服务端过滤兜底（discover/github.ts query）——比 client 侧信号更可靠 |
| F-3 每 repo 两次 raw 抓取（marketMeta+packageName） | 不改 | 两次不同路径且都有缓存语义，合并收益不值复杂度 |
| F-4 `sub.desc`/`sub.category` 无限长——恶意投稿可膨胀 index | ✅ | desc ≤4000/语种、category ≤8×80、非字符串剔除（marketMeta 同款上限） |
| F-5 `reusedNames` 不计 github-kind 复用 | ✅ | gh 复用计入 ghStats.reused + reusedNames |

**验证**：typecheck 0 错；615 tests 全过；分支覆盖 90.6% 过门槛；新回归用例覆盖：integrity 回填、远端放行不复活 hold、blocklist 损坏硬退/缺文件放行、seed 元数据截断、existing 条目 cap 豁免、live-undiscovered 保留、正向 filtered、gh tree 暂态/404/证据拒三分支、searchTopic fork:false、scan 成员数 cap、stale-metrics refreshMeta。
