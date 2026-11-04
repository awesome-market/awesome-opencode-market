# 数据流全景（Data Flows）

> 本体 = `catalog` 分支上的数据文件；其它一切（站点、客户端、issue、workflow）都是它的投影或写入端。
> 核心不变量：**hold 是默认态**——任何版本必须先过机械红线、云验证、AI/人工裁决、日报公示，才会变成用户可见可装的版本。

```
投稿issue ──┐                                    ┌─ ai-diagnose.sh ─→ ai-verdicts.jsonl
            │  submissions.txt                   │
npm/GitHub ─┼─→ catalog.yml ──→ index.json ──────┼─→ verify.yml ────→ index.json（verification 槽）
  发现      │  （发现+扫描+合并）                  │
            │                                    ├─ concern/submit ─→ ai-verdicts.jsonl（人工裁决）
            │                                    │
            │                                    ├─ publish-digest ─→ digest/*.md + digest-state.json
            │                                    │                         （成熟度锚点 lastDigestAt）
            │                                    │
            │                                    ├─ docket.yml ──────→ [review] issues ⇄ verdict 标签
            │                                    │
            └────────────────────────────────────┴─→ 下一次 catalog run 前置
                                               applyMatureVerdicts → 放行/拦截 → Pages 站点 → 客户端
```

---

## 0. 数据面：catalog 分支文件清单

`catalog` 是**纯数据分支**（无 pipeline 源码），所有 writer 通过 `git worktree` + rebase-retry 写入。

| 文件 | 写入方 | 消费方 | 语义 |
|---|---|---|---|
| `index.json` | catalog.yml publish / verify.yml merge | 站点构建、客户端、diagnose、docket、verify plan | 完整目录（含 pending——数据面全量，展示面各自过滤） |
| `ai-verdicts.jsonl` | diagnose、submit.yml verdict、concern.yml | run.ts、docket、digest | **append-only** 裁决流水；同 name@version 最新 `at` 胜出 |
| `submissions.txt` | submit.yml ingest | run.ts `--seed` | JSONL：一行一个 `{name,repo,type,category,desc}` |
| `digest-state.json` | publish-digest.sh | run.ts | `{lastDigestAt}` — pass 成熟度锚点；缺失=-∞=全冻结 |
| `digest/YYYY-MM-DD.md` | publish-digest.sh | 人（手机/网页） | 日报：新放行表 + held 积压 + concerns + 审核单链接 |
| `blocklist.json` | 手工 | run.ts | names/slugs 硬封禁 |
| `removed`（index 内） | run.ts tombstone | 站点/客户端 | 消失条目墓碑（180 天保留期） |

### AiVerdict 记录（每行一个）

```json
{"name":"pkg","version":"1.2.3"|null,"verdict":"pass"|"concern",
 "reason":"中文理由","reasonEn":"english reason","at":"ISO",
 "source":"ai"|"human","sha":"sha512-…（可选）"}
```

- `version: null` = github-kind 条目（无版本概念）。
- `source` 由写入方盖章，模型永远写不出 `human`。
- `sha` = 审核时 npm `dist.integrity`——同 hash 重打 tag 可复用裁决。

---

## 1. 收录发现流 — `catalog.yml`（每天 2 班 + 手动）

`generate`（permissions:{} 零权限，跑不可信元数据）→ `publish`（唯一 index writer）→ `site`（Pages）→ `alert`（失败开 issue）。

```
discoverNpm + discoverGithub（并行）
  → + submissions.txt 种子注入（seed 绕过 --max 字母序截断）
  → 入场过滤：preAdmit(archived/fork) + looksLikeTemplateSpam(owner 级)
  → 确定性排序 name-asc → cap 2000
  → 逐候选 worker（10 并发）：
      同版本+同 ruleset → 整体复用旧条目（增量短路，>7d 只刷 metrics）
      fetchPackument → hasPluginEvidence → fetchTarball+scanTarball
        → capabilities{findings,redFlags,rulesetVersion}
      redFlags>0 → verification={status:'skipped'}
      fetchRepoMeta(repoId/stars) + fetchRepoTree(SKILL.md 探测) + fetchMarketMeta
      repo package.json ≠ 包名 → finding 'sec:repo-mismatch'
      组装 entry：approval='pending', approvalReason='awaiting-review'
      hold 手术（见 §7）
  → github-kind 补集（无 npm 对应物的 repo 候选）
  → gone-check：旧条目消失 → 探活 → tombstone
  → buildIndex = mergeEntries（双层缓存+trustFlags+skipped 不变量）
                + dedupeSlugs + corruptionGate（空/掉幅>20% 拒发）
  → index.json → publish job 写 catalog（remerge+retry）
  → notify-published：落地的投稿 issue 评论+关闭
```

**前置步骤（顺序负载）**：`generate` 开头先把 catalog 分支取下来，跑 `applyMatureVerdicts(old, verdicts, lastDigestAt)` —— 成熟裁决先作用于旧 index，再做发现比对（否则高频包的 pendingUpdate 会被下一班 npm bump 覆盖，永远饥饿）。

**mergeEntries 双层语义**：
- 身份层（name 匹配）：firstSeenAt/slug/aliases/discoveredVia 跨版本保留
- 版本层（name@version+host 匹配）：capabilities/verification 按版本槽恢复
- trustFlags（sec:name-reused/repo-recreated/version-rollback/maintainer-changed/sec-delta:*）：身份级 flag → 展示槽；`sec-delta:*` → pendingUpdate.capabilities
- 不变量：`redFlags>0 且 verified|unverified → 'skipped'`（"有高危信号没跑" ≠ "还没验"）

---

## 2. 投稿流 — `submit.yml`

```
issue(opened/edited/labeled/comment on [submit])
  → review job（per-issue 并发组）
      parseSubmission（issue-form 段 + freeform 兜底）
      机械审查 review.ts：npm 存在性/插件证据/静态扫描 → verdict: clean|flagged|invalid
      守卫：非作者触发重审 → flagged；issue>24h 且包注册晚于 issue → flagged（防蹲名）
      verdict 取文件中 LAST 'verdict:'（防包内文本注入伪造）
      评论报告 + 打 submission:{approved|needs-work|invalid} 标签
      ⚠️ 机械通过只是"入场"，不是上架
  → ingest job（clean 时）：去重 append submissions.txt → catalog run --seed 消费
  → verdict job（人工通道，见 §5）
  → sweep job（每日）：invalid/needs-work 30 天无更新自动关
```

---

## 3. 验证流 — `verify.yml`（每天 2 班 + `targets` 手动指定）

```
plan job：index → planTargets（unverified && !redFlags && 有版本，cap 48）
      target.version = pendingUpdate?.version ?? latestVersion（验的是待上架版本）
      手动 targets= 逗号包名 → 定向验证（重验/演练用）
      shard 12/组 → matrix
verify job（permissions:{} 零权限 + harden-runner egress 白名单）：
      npm i -g @opencode/cli@2.2.5（与 OPENCODE_VERSION 常量钉齐）
      verifyPackage(name@version):
        L1 install: 隔离 HOME+XDG 全家 → `opencode plugin add name@ver`
        L1.5 load: `opencode serve` → BasicAuth(opencode:pw) → POST /api/session
                   （2.2.5 懒加载：GET 不触发，POST session 才 load）
                   日志 canary `loading plugin id=<name>`
        L2 interactive: features 含 tui → tmux 冒烟
        L3a render: features 含 gui → jsdom+vm 加载 gui bundle、
                    捕获 ctx.add 注册点、render() 进真 DOM 断言不抛
        → VerifyResult{name,version,status:verified|failed,level,...}
merge job：mergeResults 按 version 路由写槽
      r.version == pendingUpdate.version → 写 pendingUpdate.verification
      r.version == latestVersion 或空 → 写 entry.verification
      两槽都不匹配 → 过期结果丢弃（npm 中途又发新版）
      写回 catalog（rebase-retry）+ 重建站点
```

结果 → `verification.status ∈ {verified, failed, skipped, unverified}` + `level ∈ {install, load, interactive, render}`。

---

## 4. AI 诊断流 — `bin/ai-diagnose.sh`（launchd 每小时；手动同命令）

```
catalog clone → diagnose.ts（DIAGNOSE_LIMIT 默认 50；DIAGNOSE_NAME 定向）
  候选 = pending 条目且 (pendingUpdate?.version ?? latestVersion) 无 verdict
       （latestVerdicts 按 vkey(name,version) 判重——NUL 分隔符防 scope 撞名）
  每候选：
    reviewMaterial = manifest + findings + redFlags + pending 行
      （结构化材料块，不是整包源码——降 off-distribution 误报和注入面）
    L0.5（Galvanize-2, l05_score.py）逐块打分
      ≥0.662 → l05flag{zh,en}（红旗，压过 LLM 自判）
    Ornith（omlx, OpenAI 兼容）→ {verdict, reason_zh, reason_en}
    合成：
      l05flag → concern（reason 双语：红旗优先 + LLM 上下文）
      否则    → r.verdict（reason=reason_zh, reasonEn=reason_en）
    fail-closed：Ornith 挂 → 该候选本次无 verdict（下轮重试，保持 held）
               L0.5 挂 → 仅记日志，LLM 照常
  append ai-verdicts.jsonl → commit → pull --rebase → push（3 次重试）
```

Env：`AI_BASE_URL`（默认 `http://localhost:8001/v1`）、`AI_MODEL`、`AI_API_KEY`（见 `~/.config/opencode-market/ai.env`）。

---

## 5. 人工裁决流 — `concern.yml`（maintainer 专属，手机可用）

四条通道，全部写 `source:human` verdict：

| 通道 | 触发 | 目标解析 |
|---|---|---|
| ① 标签点选 | `[review]` issue 打 `verdict:pass`/`verdict:concern` | 标题 `[review] name[@ver]` |
| ② 裸命令 | `[review]` issue 评论 `/approve`、`/concern [理由]` | 同上 |
| ③ 带参命令 | **任意** issue 评论 `/concern pkg[@ver] [理由]` | 参数（ver 空→npm 最新） |
| ④ 表单 | `[concern]` issue（concern.yml 模板，下拉选 pass/concern） | 表单字段 |

**守卫链**：labeled 事件无 labeler 身份 → `gh api collaborators/{actor}/permission` 要求 write+（不足→撤标签+评论）；`[submit]` issue 跳过（submit.yml 的地盘）；目标必须在 index 里（不在→评论提示不写盘）。写盘后：评论确认 + `review:pending`→`review:decided` + 关单。

**并发模型**：`concurrency: verdict-${{issue.number}}`——每条裁决事件必须落盘，**不能共享 catalog-branch 锁**（GitHub 并发组只留 1 个 pending，burst 会静默丢裁决）。跨 issue 写竞争由 append 步的 fetch→append→commit→push 3 次 rebase 重试吸收。

**submit.yml verdict job**（投稿通道，同语义）：
- 非 bot 打 `submission:approved` 标签 或 collaborator 评论 `/approve`/`/concern [理由]`
- 目标=投稿包名（issue body 解析），版本=npm 最新+`dist.integrity` sha
- bot 打的标签不算（机械审永不自行发布）

---

## 6. 日报流 — `bin/publish-digest.sh`（launchd 每日 21:00）

```
digest.ts --index --verdicts --state --out-dir
  fresh = at ∈ (lastDigestAt, now] 的 verdict
  ① 新放行表：fresh pass（理由双语 + 审核单链接）
  ② held 积压清单
  ③ concerns 表
  → digest/YYYY-MM-DD.md
  → digest-state.json {lastDigestAt: now}   ← 成熟度锚点推进
  → commit + push
```

**这是唯一完整的上架预告面**。没有它：pass 永不成熟（-∞ 冻结=总闸）。有了它：窗口内 pass 立刻成熟 → 下一班 catalog 放行。

---

## 7. 放行流 — catalog run 前置 `applyMatureVerdicts`

**hold 手术**（run.ts worker 内，新版本到达时）：
```
prev.approval≠pending 且 npm latest≠displayed
  → pendingUpdate={version,capabilities,verification,features,publishedAt,heldAt,reason}
  → 展示字段钉在旧版（latestVersion/capabilities/verification 回写 prev）
pending 条目 bump → 就地换候选（无可展示态要保）
npm latest 消失/回滚 → 携带全部展示态
```

**放行判定**（两个版本槽各自查 `vkey(name, version)` 的最新 verdict）：

```
concern（任何 source）→ 立即生效不等成熟：
   pendingUpdate → pu.reason 标注；展示版本 → approval 拉回 pending（人工刹车）
pass → 需 mature（v.at ≤ lastDigestAt）
   && !(source=ai && 目标 capabilities.redFlags>0)   ← AI pass 落红旗条目=忽略（纵深防御）
   && verification.status ∈ {verified, skipped}      ← RELEASABLE
      verified=实测可装；skipped=高危没跑——只人工 pass 能放（知情裁决）
      unverified/failed 永不放（fail-closed）
→ approved：latestVersion/publishedAt/capabilities/verification/features ← pendingUpdate
→ pendingUpdate 清除
```

**net 语义**：用户能装的版本 = 机械红线 + 验证 + 成熟 pass 全过的版本。concern 不需要公示期（保守方向），pass 必须过日报窗口（预告期）。

---

## 8. 审核单流 — `docket.yml`（hourly + catalog/verify 完成后 + 手动）

```
docket.ts：index+verdicts → docketTargets
  = pending 目标(pendingUpdate?.version ?? latestVersion) 且 最新 verdict.source='ai'
  （AI 已判、待人过目：pass 等放行窗口，concern 等人工翻案）
同步：
  缺失 → 开 [review] name@ver（labels: review:pending + ai:{verdict}，
        body 写明：AI 判定双语理由+验证状态+手机点选说明）
  多余 → 关单（已决议/已放行）
  → bootstrap 标签（verdict:pass/concern, review:pending/decided, ai:pass/concern）
```

人 → 标签 → concern.yml → verdict → 关单 → docket 下轮清理。闭环。

---

## 9. 站点发布流 — `pipeline/site/build.ts` → GitHub Pages

```
index.json（catalog 分支现取，不吃旧 artifact）
  → /tmp/site:
      index.json      全量 catalog（含 pending——可审计数据面）
      index.html      列表页（filter isVisible：pending 不渲染）
      p/<slug>.html   详情页（pendingUpdate 行显示"under review — not installable yet"）
      skills/index.json + skills/<id>/  HTTP skill catalog（npm tarball 抽 md）
      health.json     {ok, entries(可见数), generatedAt}
      privacy.html
  → deploy-pages
```

诚实状态文案（AGENTS 规约）：verified=已实测可装可用 / failed=装不上或加载失败 / skipped=有高危信号没跑 / unverified=还没验；legacy 徽标 = 门禁前老条目；"没扫到"必带"不等于安全"。

---

## 10. 客户端消费流 — `plugins/market`

```
fetchIndex(Pages index.json, 10s 超时)
  → sanitizeIndex（剥 ANSI/C0——untrusted 输入）
  → filter isVisible（pending 永不进 UI/安装路径）
  → TTL 缓存 localStorage 1h + 失败快照兜底
UI（gui.ts/tui.tsx）：
  列表 rows()（verified 优先）/ search / categoriesOf
  安装：pinSpec(e) = name@latestVersion（钉到批准版，隐式 latest=绕过通道）
       api.install({name, spec}) → `plugin add <spec>`
  更新：add 钉版 spec → dedupeToSpec 重写 config plugins[]
       （plugin add 不去重会留双 spec——E2E 实锤）
  展示：verification 四态文案同站点
```

---

## 11. 不变量与 fail-closed 速查

| 规则 | 机制 |
|---|---|
| 默认不可见 | `approval='pending'` 新生即持有；站点/客户端都过滤 |
| 机械审不发布 | submission:approved 只进 submissions.txt；bot 标签不写 verdict |
| AI 不越权 | `source` 由写入方盖章；AI pass 落 redFlags 条目被忽略 |
| pass 要预告 | mature = at ≤ lastDigestAt；缺 digest-state = 全冻结 |
| concern 即时 | 不等窗口；打展示版本=撤回上架（人工刹车） |
| 验证是硬门 | unverified/failed 永不放；skipped 只人工 pass 可放 |
| 版本钉死 | 验证验 pendingUpdate 版本；客户端装 pinSpec；`plugin add` 不隐式 latest |
| 审计可回放 | verdicts append-only，同键最新 at 胜出，sha 溯源 |
| 写冲突不丢数据 | 数据分支写入都走 fetch→改→commit→push 重试循环 |
| 裁决事件不丢 | verdict 类 job 用 per-issue 并发组（共享锁会丢 pending） |
| 发布不破目录 | corruptionGate：空 index/掉幅>20% 拒发 |
| 不可信代码零权限 | generate/verify jobs permissions:{} + egress 白名单 |

---

## 12. 触发器总表

| 事件 | 工作流/脚本 | 写什么 |
|---|---|---|
| cron 03:17/11:00 + dispatch | catalog.yml | index.json、站点、tombstone、投稿通知 |
| cron 04:47/16:47 + dispatch(targets) | verify.yml | index.json（verification 槽）、站点 |
| issue [submit] opened/edited/labeled/comment | submit.yml | 评论、submission 标签、submissions.txt、ai-verdicts.jsonl（人工通道） |
| issue [review]/[concern] opened/labeled + 评论 | concern.yml | ai-verdicts.jsonl、review 标签、关单 |
| hourly + catalog/verify 完成 + dispatch | docket.yml | [review] issues、标签 |
| launchd 每小时 | bin/ai-diagnose.sh | ai-verdicts.jsonl |
| launchd 每日 21:00 | bin/publish-digest.sh | digest/*.md、digest-state.json |
| 用户 plugin add | 客户端 | 本机 opencode.json（不在本仓库数据面） |

时序约定：digest(21:00 本地) → catalog(03:17/11:00 UTC) → verify(04:47/16:47 UTC) → docket(每小时 :40)。launchd 需系统盘路径或 TCC 授权（外置卷会 `Operation not permitted`）。
