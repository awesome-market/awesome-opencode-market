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
- 消歧规则：npm 名优先于 repo（npm 名才是稳定身份；scoped 名还天然免疫抢注，见 §五）。monorepo 多包共用 repo 时 slug 用 `name` 而非 `owner/repo`。
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

### SEC-4 前置：存量回填

线上 496 条无 createdAt/repo.id/maintainers 历史，部署比对前跑一次回填 pass，否则首轮全盲/误报。

### SEC-5 verify 的诚实定位

沙箱验证只证"装得上加载通"，对 metadata/delta 都穿透的恶意件无能为力——不防"是坏人"。verified 徽章语义边界要在外部话术里说清（AGENTS.md：没扫到≠安全）。

---

## 六、优先级（依赖序）

```
第一梯队 正确性止血（纯代码，无迁移）：
  I-2 merge 两层 key → I-1 slug 唯一性+存量修复 → I-3

第二梯队 流程兑现：
  排序确定化+cap → D-2 submit 持久化 → D-1 ghList 决策

第三梯队 失效与安全（依赖 #9 字段先落盘）：
  SEC-1 字段落盘 → SEC-4 回填 → SEC-2 比对规则 → F-2 removed 段 → SEC-3 delta 扫描

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
