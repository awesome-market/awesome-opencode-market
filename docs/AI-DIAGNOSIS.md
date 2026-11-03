# AI 审核与上架管线设计

> 状态：设计定稿 v2，待实现。
>
> v2 相对 v1 的关键变化：机械审查 clean 不再自动上架（原自动仅为开发期便利）；
> AI 权限模型定为**二审否决权**（收窄任务、去语义化输入）而非放行特赦；
> 增加每日上架日报 + 恒定否决窗口；版本风暴用 latest-only + delta-findings 限频。

## 1. 目标与原则

投稿审查要覆盖"大部分插件自动审核上架"，人只做两件事：**每天看明日上架
日报**（可一票否决）+ **处理风险件**。设计假设人的注意力会退化到零
（流于形式是常态）——安全底线必须由机械红线 + AI 客观判定构成，不能
依赖人的认真。

四条不变原则：

- AI 输出（除结构化的二审判定外）永远只是评论，不进 verdict/label/ingest
- 本机只跑文本推理，**绝不执行投稿包代码**（云端验证，DEV.md 同规）
- 机械 redFlags 永远转人工——AI 不能替代"计划外发现"
- 全程可审计：AI 判定理由留档、日报是公开上架日志

## 2. 验证深度现状（云端）

| 层级 | 状态 | 做法 |
|---|---|---|
| 静态代码分析 | ✅ | `scanTarball` 规则集（findings/redFlags） |
| 安装测试 | ✅ | `opencode plugin add` 真装进 XDG 隔离环境 |
| 真实运行 | ✅ headless | `opencode serve` + API 触发懒加载 + `loading plugin` canary |
| TUI 交互级 | ❌ 二期 | `tmux` 驱动真 TUI + `capture-pane` 断言无 panic（Linux runner，需 pty） |
| Windows 兼容 | 可选 | public repo runner 免费；Windows 无 pty，只适合 serve headless 分片 |

安装/运行测试一律云端（GitHub Actions），本机不做任何装测。

## 3. 总体架构

```
投稿 issue
   │
   ▼ submit.yml review job（仅 opened/edited + 合格评论触发）
机械初审 → verdict
   ├─ clean   → submission:ai-review      ← 初审通过，等 AI 二审（不再自动上架）
   ├─ flagged → submission:needs-work ──┐
   └─ invalid → submission:invalid    ──┤
                                        │  label = AI 队列（GitHub 侧，断网免疫）
        本地 cron/launchd（每小时）      │
   ┌────────────────────────────────────┘
   ▼ pipeline/ai-diagnose.ts
   ├─ ai-review 队列 → 二审（见 §4 任务收窄）
   │    ├─ pass    → submission:ai-approved（明日上架池）
   │    └─ concern → submission:needs-work + 疑虑草稿（转人工）
   └─ needs-work/invalid → 诊断草稿帮人判断（不裁决）

每日日报（本地 cron 21:00，固定 issue 盖楼）：
   "明日上架 N 个 + 各件 AI 理由摘要；人工待定 M 个"
   → 次日 07:00 publish 前 = 恒定 ~10h 人否决窗口
   → 否决动作 = 摘掉 issue 的 ai-approved 标签（零新机制）

publish job（每日 07:00，catalog run 前）：
   批量拉 ai-approved + approved（人工通道）标签 → ingest → submissions.txt
   → 下一趟 catalog run 上架 → notify 评论+关闭 issue
```

## 4. AI 二审：任务收窄 + 去语义化输入

**权限模型：否决权，不是特赦权。**

| 机械 verdict | AI 可判 | 注入攻击的最坏结果 |
|---|---|---|
| clean → ai-review | pass / concern | 骗"pass" → 回到机械 clean 自动上架的旧基线，**不更差** |
| flagged → needs-work | （只能出草稿，无裁决权） | 注入无法突破机械红线 |
| invalid | 同上 | 同上 |

AI 误判方向恒为保守：误拦 → 人看一眼；绝不误放。

**输入面——只做安全判断，不读散文：**

```
system: 你是安全审查员。对每个 finding 判定 true_positive 或
        false_positive 并给一句技术理由。输出严格 JSON：
        { "verdict": "pass"|"concern",
          "signals": [{ "finding": "...", "tp": bool, "reason": "..." }] }
user:   <data>
        - 结构化元数据（name/version/maintainers/createdAt/repoId 变更）
        - 机械扫描的 findings + redFlags（规则:文件:命中行）
        - 命中代码行摘录（≤80 字符/行，截断）
        - 文件清单（路径名）
        </data>
```

不喂：描述、README、issue 散文、其他用户评论——连续叙述性文本是最大的
注入面。残余注入只能藏在代码行/标识符里，且要先骗过机械规则命中才会
被 AI 看到；最坏结果仍回落到基线，不更差。

**输出校验**：严格 JSON schema；`verdict` 非 `pass` 一律当 concern 处理
（含解析失败——失败不 retry 空转，贴一次"诊断暂不可用"出队）。

**上架后复审（版本风暴防护）**：AI 触发器是**新增信号**不是版本数——
新版本带来新 finding/redFlag（merge 已算 delta）→ 该条目进人审队列；
无新信号的版本 bump 静默通过。发包频率不产生 AI 工作量。

## 5. 标签状态机

| label | 含义 | 谁贴的 | 下一状态 |
|---|---|---|---|
| `submission` | 投稿标记 | 表单模板 | → 初审 |
| `submission:ai-review` | 机械初审过，待 AI 二审 | bot | → ai-approved / needs-work |
| `submission:ai-approved` | AI 二胜过，明日上架池 | 本地脚本 | → publish 上架 |
| `submission:approved` | 人工批准（label/approve） | triage+ 人 | → publish 上架 |
| `submission:needs-work` | 人工队列（机械红旗+AI疑虑） | bot/AI | → 修复重审 / sweep |
| `submission:invalid` | 待修正 | bot | → 修复重审 / sweep |
| `submission:ai-diagnosed` | 已出草稿（幂等标记） | 本地脚本 | → 重审时清除重诊 |

## 6. submit.yml 改动点

1. `issues.types` 加 `labeled`；review `if` 精确到 `opened|edited|合格评论`
   （评论排除 bot、`ai-diag` 标记、`/approve` 开头）
2. verdict 映射改三态：clean→`ai-review`（**不再 approved/ingest**）、
   flagged→needs-work、invalid→invalid；贴 needs-work/invalid 时清
   `ai-diagnosed`
3. 新增 `approve` job：人工 labeled `submission:approved`（排除 bot sender）
   或 owner `/approve` 评论 → 贴 approved + 确认评论
4. 新增 `publish` job（`schedule` 每日 07:00 + `workflow_dispatch`）：
   拉 `ai-approved`+`approved` open issues → 逐 issue 解析 subline →
   批量 append submissions.txt（catalog 分支，共用 `catalog-branch` 锁）
   → 给每件评论"已提交今日上架批"
5. ingest job 删除（职能并入 publish）或保留为单件即时通道（人工急用）

## 7. 本地组件

**pipeline/ai-diagnose.ts**（TS，可测试，~200 行）：
队列拉取 → 物料组装（去语义化）→ localhost:8001 → JSON 校验 →
贴草稿/标签。LLM key 从 `~/.config/opencode-market/ai-key` 读。
lockfile 防并发。任何异常静默退出，下趟补。

**pipeline/publish-digest.ts**（日报）：
拉 ai-approved/approved issues → 渲染"明日上架清单 + AI 理由 +
人工待定清单" → 在固定 digest issue 评论盖楼。

**launchd**：两档——ai-diagnose 每小时；digest 每日 21:00。

## 8. 安全边界

| 边界 | 依据 |
|---|---|
| AI 无特赦权（flagged/invalid 只起草） | 注入不可突破机械红线；AI 误判方向恒保守 |
| 输入去散文（无 README/描述/评论） | 注入面只剩代码行，且须先骗过机械规则 |
| 输出严格 JSON schema | 无自由文本藏私货；解析失败=concern 兜底 |
| 本地零执行 | 装测全在云端 runner（零 token、egress 白名单） |
| 日报≠审批，是反悔窗口 | 人注意力归零时系统保底仍成立 |
| `/approve` 限 owner + labeled 排除 bot | 人通道不被 AI/自身循环触发 |
| LLM key 只进 `~/.config/` | 不进 git、workflow、日志 |

## 9. 边界情况

| 场景 | 结果 |
|---|---|
| 批准不存在的包 | catalog packument 404 → 不落，无害 |
| 误批 | blocklist.json 下架（tombstone `manual`） |
| 日报后想拦某件 | 摘 ai-approved 标签即出批（label timeline 留痕） |
| 版本风暴（一天 10 版） | 只扫 latest；无新信号静默；verify 每趟限频——成本与发版频率解耦 |
| 上架后投毒（v1过审 v2藏毒） | 新 finding 出现 → delta 触发 → 进人审队列 |
| AI/LLM 挂掉 | 队列堆积在 GitHub label，恢复后消化；单件诊断失败贴一次出队 |
| 断网 | 队列零本地状态，下趟补 |

## 10. 不做清单

- AI 不裁决 flagged/invalid（只起草）
- AI 输入不含散文（README/描述/评论不进 prompt）
- 不在本机执行投稿代码
- 不做 TUI/desktop 实时测试（二期：tmux TUI 断言 + Windows headless 分片）
- 不做 verify 失败 AI 归因（三期：logExcerpt 聚类周报）

## 11. 验收清单

- [ ] clean 投稿 → `ai-review` 标签，不自动 ingest
- [ ] AI 二审 pass → `ai-approved` → 日报含此件 → 次日上架
- [ ] AI 二审 concern → `needs-work` + 疑虑草稿
- [ ] 人工勾 `approved` / 评论 `/approve` → 进明日批
- [ ] 日报后摘 `ai-approved` → 该件不在次日上架
- [ ] bot 贴的 label 不触发 approve job；AI 评论不触发重审
- [ ] 断网时段脚本静默失败、恢复后补跑
- [ ] 同包新版本无新 finding → 不进 AI 复审
