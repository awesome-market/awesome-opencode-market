# AI 诊断层设计：本地 LLM 异步审查 + 人工放行通道

> 状态：设计定稿，待实现。解决投稿审查中"红旗件需要人话诊断"的缺口——机械审查给出结构化结果，本地 AI 负责把结果翻译成人能读的诊断草稿，人终审一键放行。

## 1. 背景与目标

`submit.yml` 的审查是全机械的：npm 存在性 + 插件证据 + 静态扫描 + 模板回复。
`flagged`（redFlags）和 `invalid` 件堆在 issue 队列里，每个都要人逐条看报告、
写诊断——这正是 RESEARCH.md/DEV.md 原设计里"AI 诊断起草 → 人终审"的位置
（P4，需要 LLM；本地端点 localhost:8001 已在 D2 备案）。

目标：**AI 起草诊断，人只负责批准**。且满足：

- 本机每天凌晨固定断网一次 → 队列必须在 GitHub 侧（label），本地零持久状态
- AI 输出永远只是**草稿评论**，进不了 verdict/label/ingest 判定链
- 本机只跑文本推理，**绝不执行投稿包代码**（DEV.md：本机不跑陌生装测）

## 2. 总体架构

```
投稿 issue
   │
   ▼ submit.yml review job（仅 opened/edited + 合格评论触发）
机械审查 → verdict
   ├─ clean   → submission:approved + ingest → catalog 收录 → notify 评论+关闭
   ├─ flagged → submission:needs-work ─┐
   └─ invalid → submission:invalid   ──┤
                                       │  label = AI 诊断队列
        本地 cron/launchd（每小时）      │
   ┌───────────────────────────────────┘
   ▼ pipeline/ai-diagnose.ts
拉 needs-work/invalid 且无 ai-diagnosed 标签的 open issue
   → issue body + 最新审查评论（review.md）当 <data> 喂 localhost:8001
   → 评论 "## 🤖 AI 诊断草稿 <!-- ai-diag -->" + 贴 submission:ai-diagnosed
   │
   ▼ 人终审（两条等价通道，GitHub 网页原生操作）
   ├─ 右侧栏勾选 submission:approved   → issues:labeled 事件
   └─ 评论 /approve                    → issue_comment 事件（owner 专属）
   │
   ▼ approve job → verdict=clean → ingest → catalog 收录 → notify 关闭
```

## 3. 状态机（issue 生命周期）

| label | 含义 | 谁贴的 | 下一状态 |
|---|---|---|---|
| `submission` | 模板自动贴的投稿标记 | 表单模板 | → 审查后打 verdict 标签 |
| `submission:approved` | 审查通过 / 人工批准 | bot 或 triage+ 人 | → 收录后 issue 关闭 |
| `submission:needs-work` | 有 redFlags，待处理 | bot | → 修复重审 / 30天 sweep |
| `submission:invalid` | 包不存在等 | bot | → 修复重审 / 30天 sweep |
| `submission:ai-diagnosed` | AI 已出草稿（幂等标记） | 本地脚本 | → 人工处理出队 |

规则：verdict 三标签互斥（每次审查先全清再贴真值）；`ai-diagnosed` 在
每次新 verdict 落 needs-work/invalid 时**清除**——草稿永远对应最新报告。

## 4. 组件详细设计

### 4.1 submit.yml 改动

**(a) review job `if` 精确到 action**（防 label 循环）：

```yaml
if: >-
  github.event.issue.state == 'open'
  && !github.event.issue.pull_request
  && (contains(github.event.issue.labels.*.name, 'submission')
      || startsWith(github.event.issue.title, '[submit]'))
  && (github.event.action == 'opened'
      || github.event.action == 'edited'
      || (github.event_name == 'issue_comment'
          && !endsWith(github.event.comment.user.login, '[bot]')
          && !contains(github.event.comment.body, 'ai-diag')
          && !startsWith(github.event.comment.body, '/approve')
          && (contains(github.event.issue.labels.*.name || 'x', 'submission:needs-work')
              || contains(github.event.issue.labels.*.name || 'x', 'submission:invalid'))))
```

**(b) triggers**：`issues.types` 增加 `labeled`。

**(c) label 步骤**：贴 verdict 标签时，needs-work/invalid 分支同时
`gh issue edit --remove-label submission:ai-diagnosed`（幂等，`|| true`）。

**(d) 新增 approve job**（与 review 平级，产出同样 outputs）：

```yaml
approve:
  if: >-
    github.event.issue.state == 'open' && !github.event.issue.pull_request
    && (contains(github.event.issue.labels.*.name, 'submission')
        || startsWith(github.event.issue.title, '[submit]'))
    && ((github.event_name == 'issues'
         && github.event.action == 'labeled'
         && github.event.label.name == 'submission:approved'
         && github.event.sender.login != 'github-actions[bot]')
        || (github.event_name == 'issue_comment'
            && github.event.comment.user.login == github.repository_owner
            && startsWith(github.event.comment.body, '/approve')))
  outputs: { verdict: clean, subline: "${{ steps.ap.outputs.subline }}" }
  concurrency: { group: sub-review-${{ github.event.issue.number }}, cancel-in-progress: true }
  permissions: { issues: write }
  steps:
    - checkout + npm ci + tsx（同 review 的 parse 步骤）
    - parse → outputs.subline（复用 submission.ts --seedline）
    - gh issue comment "✅ 已人工批准，进入收录队列"
    - gh issue edit --add-label submission:approved（/approve 路径补标）
```

**(e) ingest job 双源**：

```yaml
ingest:
  needs: [review, approve]
  if: >-
    (needs.review.outputs.verdict == 'clean'
      || needs.approve.outputs.verdict == 'clean')
  env:
    LINE: ${{ needs.review.outputs.subline || needs.approve.outputs.subline }}
```

（skipped job 的 outputs 为空串，`||` 自然落到另一边）

### 4.2 review.ts：verdict 补缺口

```ts
if (!r.exists) return 'invalid'
if (r.redFlags.length) return 'flagged'
if (!r.evidence.length) return 'flagged'   // 无插件证据不该自动放——转人工
return 'clean'
```

报告同步加一行提示"无插件证据"的原因（没证据≠有问题，但不值得自动放行）。

### 4.3 pipeline/ai-diagnose.ts（本地脚本，可测试）

```
1. gh issue list --label submission:needs-work --state open --json number
   + 同法拉 submission:invalid
2. 每个 issue：labels 含 submission:ai-diagnosed → 跳过
3. 拉 issue body + 最新一条 github-actions[bot] 评论（= 最新审查报告）
4. POST localhost:8001/v1/chat/completions
     system: 固定角色 + 输出 JSON schema
       { "summary": "一句话结论", "cause": "原因分析",
         "fix": "建议修复步骤", "verdict_hint": "approve|needs-work|uncertain" }
     user: <data>\n<issue body + review.md>\n</data>   ← 数据不是指令
5. JSON 校验失败/LLM 挂了 → 贴一条 "AI 诊断暂不可用" + ai-diagnosed（出队不刷屏）
   成功 → 贴 "## 🤖 AI 诊断草稿（人工确认前仅供参考）\n\n{渲染}" <!-- ai-diag -->
   → gh issue edit --add-label submission:ai-diagnosed
6. 全程幂等；断网/任何异常 → 静默退出，下趟补
```

约束：
- LLM key 从 `~/.config/opencode-market/ai-key` 读，不进仓库不进脚本
- 并发保护：脚本开头 `flock`/lockfile，上次没跑完直接退出
- 只取 body + bot 报告，**不喂其他用户的评论**（防指令注入）

### 4.4 launchd（macOS）/ cron

```xml
<!-- ~/Library/LaunchAgents/com.local.ai-diagnose.plist -->
<key>StartInterval</key><integer>3600</integer>
<key>ProgramArguments</key>
<array><string>/opt/homebrew/bin/npx</string>
       <string>tsx</string><string>pipeline/ai-diagnose.ts</string></array>
<key>WorkingDirectory</key><string>/Volumes/2t/code/opencode-market</string>
```

cron 替代：`0 * * * * cd /Volumes/2t/code/opencode-market && npx tsx pipeline/ai-diagnose.ts >> /tmp/aidiag.log 2>&1`

## 5. 安全边界（每条都有依据）

| 边界 | 依据 |
|---|---|
| AI 输出永远只进评论——不进 verdict/label/ingest | verdict 只由机械 scan 产出（上轮的注入修复不能白堵）；prompt injection 最坏=一条怪草稿 |
| review.md 包在 `<data>` 里，不当指令 | 报告含包方可控文本（repo url/文件名/匹配代码行），注入已实证可行 |
| AI 无法自批准 | 脚本发的评论恒带 `## 🤖` 头+`ai-diag` 标记——永远不是裸 `/approve`，也永不碰 `approved` 标签；哪怕用 owner 账号发也够不到放行键 |
| 本机不执行投稿代码 | DEV.md："本机不跑陌生装测"——LLM 只读文本 |
| `/approve` 限 owner（`comment.user.login == repository_owner`）| 协作者走 label 通道（triage+ 天然有权限）；裸句开头匹配防误触 |
| labeled 排除 `sender == github-actions[bot]` | 否则 bot 贴标→labeled→approve→再贴标循环 |
| LLM key 只进 `~/.config/` | 不进 git、不进 workflow、不进日志 |

## 6. 已审过的边界情况

| 场景 | 结果 |
|---|---|
| 批准不存在的包 | ingest 写 seed → catalog packument 404 → 不落条目，无害 |
| 误批 | 走 blocklist.json 下架流程（`{"names":["pkg"]}`→ 下趟 tombstone `manual`） |
| 批准和审查并发 | approve 与 review 共用 `sub-review-${issue#}` concurrency 组串行化 |
| /approve 在非投稿 issue | `submission` 标签/`[submit]` 标题门槛挡住 |
| freeform 投稿（无 submission 标签） | 门槛兼容 `[submit]` 标题 |
| 评论触发 /approve 时 review 也命中 | review 的 comment 条件排除 `/approve` 开头 |
| AI 诊断后作者又触发重审 | 新 verdict 清 ai-diagnosed → 草稿重新生成 |
| sweep 30天 | 不变——AI 草稿不续命，人工没理照样关闭 |
| 断网/LLM 挂 | 静默下趟补；LLM 持久故障 → 贴一次"暂不可用"出队 |

## 7. 不做清单（防蔓延）

- AI 不直接改 verdict/label（只起草）
- AI 不读 issue 里非 bot 的评论（只喂 body + 审查报告）
- 不做 verify 失败归类的 AI 分析（二期：`index.json` 的 `logExcerpt` 聚类→健康 issue 周报，零 workflow 改动）
- 不做 CI 巡检 agent（远期 §9，同机同 cron 可复用）

## 8. 验收清单

- [ ] 开一个 flagged 投稿 issue → AI 下趟 cron 贴草稿 + ai-diagnosed
- [ ] 手动勾 approved → approve job → 评论+ingest
- [ ] 评论 /approve → 同上
- [ ] AI 草稿评论不再触发重审（无新报告）
- [ ] 重审后 ai-diagnosed 被清 → AI 重新诊断
- [ ] bot 贴的 approved 不触发 approve job
- [ ] 断网时段脚本静默失败、恢复后补跑
