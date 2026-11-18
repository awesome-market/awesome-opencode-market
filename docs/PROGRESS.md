# 进展速览

> 看流水线现在什么状态，不用读代码。

## 最快：跑一次 status 工作流

```bash
gh workflow run status -R awesome-market/awesome-opencode-market
# 然后打开 run 页 —— Summary 页即完整进展报告
gh run list -R awesome-market/awesome-opencode-market --workflow status --limit 1
```

报告内容：open issue 分桶（ai:concern / ai:pass / concern:flags …）、判词计数（含 flagsReviewed 放行权数与对账班产出）、行级预读覆盖（已判/失败重试/带实际调用行）、最近 catalog 提交、在跑工作流。手机上开 run 的 Summary 页即可读。

## 本地命令版

```bash
C=~/.local/share/opencode-market-catalog

# 判词落地
tail -5 $C/ai-verdicts.jsonl
grep -c '"verdict":"pass"' $C/ai-verdicts.jsonl

# 后台班
tail -3 /tmp/reconcile.log               # 对账班
tail -3 /tmp/open-ctx-retry.jsonl        # 失败键重判班（JSON 每行一条）
ps aux | grep flag-context | grep -v grep

# issue 分桶
gh issue list -R awesome-market/awesome-opencode-market -l ai:concern --limit 5

# 工作流
gh run list -R awesome-market/awesome-opencode-market --limit 5
```

## 标签怎么读

| 标签 | 含义 | 要人吗 |
|---|---|---|
| `ai:concern` | AI 拦下，放行闸锁死 | ✅ 人工终裁（勾 verdict:pass/concern） |
| `concern:llm` / `concern:l05` | concern 的来源：LLM 判 / L0.5 机械拦 | 同上 |
| `concern:flags` | sec:* 身份信号（repo 漂移/重名） | ✅ 设计即人工 |
| `ai:pass` | AI 放行，公示窗中 | ❌ 无人翻案自动放行 |
| `review:pending` | 伞标签：裁决单 | 看上面三类 |
| `pipeline-alert` | 管线故障 | ✅ 运维面 |
| `report:verify-fail` | 验证失败日报 | 观察 |

`flagsReviewed` 判词 = AI 复核过红旗证据，对旗标槽有放行权；`对账：`前缀 = 对账班已审过该冲突，不会再重判。

## 后台班（本机跑着的）

- **drain**：每 ~20min 把本地 spool 增量推 catalog 分支 + dispatch docket 刷新 issue 正文
- **catalog cron**：每小时 :07/:37 折叠判词 → 放行决策
- **docket cron**：每小时 :40 + catalog 完成后自动补班

所以多数情况下什么都不用按——进展自己会流。催熟才用 `full-run`（`-f fast_mature=true` ≥30 天包龄当日放行）。
