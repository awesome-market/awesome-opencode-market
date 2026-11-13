# OpenCode Market — 开发文档

> 前置文档：`docs/RESEARCH.md`（调研结论与架构决策依据）。本文是实现层文档：做什么、怎么拆、怎么验。
> 参考源码：`docs/code/dsh-market/`（dsh-market 浅克隆，用于对照索引字段/更新语义/兼容性判定）。

---

## 0. 产品定义

**一句话**：一个自动生成的、可审计的 opencode 扩展可信索引（index.json），外加一个薄壳浏览站——数据是本体，网站是门面。

**不是什么**：不是投稿制社区站（cafe 死因）、不是应用内市场 UI（缓做）、不是付费商店（Agensi 未跑通）。

**核心差异化**（对 opencode.im/cafe）：
1. **实机验证**——每条目在 GitHub Actions 沙箱里真装真跑（它们只有人工收录/未验证）
2. **风险标记**——tarball 静态扫描结果公开（postinstall/网络/混淆/IP），且"未检出≠安全"如实表达
3. **全量自动收录**——npm/GitHub 爬取，不靠投稿（解决 cafe 死循环）

---

## 1. 系统架构

```
┌─────────────────────────────────────────────────────────┐
│ GitHub Actions (cron: daily, workflow_dispatch)          │
│                                                          │
│  pipeline/                                               │
│   1. discover   — npm keyword + GitHub search → 候选清单  │
│   2. fetch      — 元数据 + tarball 下载                   │
│   3. scan       — 静态扫描（不执行代码）                  │
│   4. verify     — 沙箱装测（见 §4 P0 gate）               │
│   5. publish    — 先 checkout catalog 分支旧索引做基        │
│                     底，逐条 merge（条目未变则保留旧的      │
│                     验证/扫描结果 = 增量缓存载体）→          │
│                   生成新 index.json → commit 到 catalog 分支 │
│                   （索引 diff 历史 = 公开审计轨迹 +         │
│                    自带仓库活性，化解定时workflow 60天禁用）│
│                   → 防损闸：新索引为空拒发（dsh-market      │
│                     build-site.mjs 同款）+ 条目数         │
│                     骤降 >20% 告警人工确认（自定义加固）    │
│                   → Pages 用 actions/deploy-pages 发布     │
│                     + jsdelivr 代理 catalog 分支做镜像     │
│                   → concurrency: 同名 workflow 串行，      │
│                     防两次 run 抢写 catalog 分支           │
└─────────────────────────────────────────────────────────┘
        │                              │
        ▼                              ▼
  index.json（数据资产）          site/ 静态目录站（薄壳）
   ├ 喂收录站渲染                  ├ 列表/搜索/详情
   ├ 将来喂官方市场 source          ├ 风险标记展示
   └ 将来喂 agent/MCP              └ SEO 占位
```

**关键约束**
- 无服务器、无数据库——index.json 是唯一数据面
- **两段式数据面**：生产端点固定为上游 org Pages（`awesome-market.github.io/.../index.json`，README 与客户端默认值一致）；开发期 catalog 流水线只跑在维护者 fork（`terry2010.github.io`），避免测试 run 污染上游 catalog 分支。客户端通过设置里的"开发目录源"开关切到 fork 源（`devSource`），显式 `indexUrl`/`OPENCODE_MARKET_INDEX` 始终优先于开关；发布时 org 侧启用流水线后默认值无需改动
- 所有验证执行都在一次性 CI runner；runner 内不放任何 secret
- **GITHUB_TOKEN 按 job 分权**：verify/scan job `permissions: {}`（全空，连读都不给——恶意 postinstall 拿不到 token）；publish job 单独 `contents: write` 且**不和 verify 共用 job**（防执行环境与写权限同处）
- pipeline 全程产物公开：workflow YAML、run 日志、index.json diff——可审计是卖点

---

## 2. 目录数据 schema（index.json v1）

对齐 Claude/Codex marketplace 字段习惯，向 Agent Plugins 1.0.0 靠拢：

```jsonc
{
  "version": "1",
  "generatedAt": "2026-11-02T00:00:00Z",
  "categories": {                          // 类目注册表：id → 本地化标签（dsh-market 同款，
    "safety":  { "en": "Safety", "zh": "安全" },   // 类目加/改都在这一处，不散落各条目）
    "context": { "en": "Context & Memory", "zh": "上下文与记忆" }
  },
  "plugins": [
    {
      "name": "opencode-loop-recover",
      "type": "plugin",                    // plugin|skill|agent|command|mcp|theme|bundle|rule
      "contains": ["skill"],                // bundle 类必填：包内装了什么（skill|mcp|command|agent|hook）
      "discoveredVia": ["npm-keyword", "github-topic"],  // 发现渠道审计（§4.5 要求，schema 必须有）
      "source": { "kind": "npm",            // npm|github——GitHub-only 条目无 npm 字段
                  "id": "opencode-loop-recover",
                  "repo": "terry2010/opencode-loop-recover" },
      "description": { "en": "...", "zh": "..." },
      "category": ["safety", "context"],   // 功能分类，多个按序
      "license": "MIT",
      "deprecated": false,                  // 弃用标记（dsh-market 同款）
      "replacement": null,                  // 弃用时建议替代条目名
      "firstSeenAt": "2026-10-15T00:00:00Z",// 首次收录时间（≠创建时间，"new this week" 依赖它）
      "latestVersion": "0.3.4",
      "publishedAt": "2026-10-28T00:00:00Z",// 最新版发布时间（将来 minimumReleaseAge/更新提示的原料）
      "metrics": {
        "stars": 12,
        "npmDownloads30d": 1039,            // 字段名如实，不冒充"装机量"
        "checkedAt": "2026-11-01T00:00:00Z"
      },
      "capabilities": {                     // 静态扫描结果；字段语义见下
        "scannedAt": "2026-11-01T00:00:00Z", // null = 从未扫过（如实区分）
        "findings": ["postinstall", "network:api.example.com", "literal-ip"],
        "redFlags": []                      // 高危项，UI 级展示
      },
      "verification": {                     // 实机验证结果
        "status": "verified|failed|unverified|skipped",
        "level": "load",                    // install（装得上）| load（能激活）| structure（仅结构校验，非代码类）
        "opencodeVersion": "2.2.5",
        "verifiedAt": "2026-11-01T00:00:00Z",
        "runUrl": "https://github.com/.../actions/runs/123",  // 完整日志在 run 里，索引只存指针
        "logExcerpt": "..."                 // 失败诊断摘录，硬截断 ≤2KB，防索引膨胀
      },
      "compat": {                           // 声明读取，结论在消费端现算
        "engines": ">=2.0.0",               // package.json engines.opencode（如声明）
        "peer": "@opencode/plugin@^2"       // 或 peerDependencies 上的宿主 SDK 包（A4 已核实）
      }
    }
  ]
}
```

**字段语义铁律**（照抄 dsh-market 的诚实模型）：
- `scannedAt: null` = 从未扫描；`findings: []` = 扫过没发现——**两者渲染不同文案，绝不混**
- `verification.status` 四态如实区分；`unverified` 不许渲染成"安全"
- `npmDownloads30d` 必须标注口径（近30天 npm 下载，非装机数）

---

## 3. 静态扫描器（pipeline/scan）

tarball 解包 → 逐文件规则匹配。**只读不执行**。

```ts
// 规则集（v1）
RULES = [
  { id: 'postinstall',     sev: 'high',   match: /"(pre|post)?install"/ },  // 含裸 "install"（同族生命周期，之前漏了）
  { id: 'prepare-script',  sev: 'high',   match: /"prepare"\s*:/ },
  { id: 'network-call',    sev: 'medium', match: /fetch\(|http\.request|curl|wget|axios/ },
  { id: 'literal-ip',      sev: 'medium', match: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/ },
  { id: 'obfuscation',     sev: 'high',   match: /eval\(|atob\(|\\x[0-9a-f]{2}.*{8,}/ },
  { id: 'binary-blob',     sev: 'high',   match: file => isBinary(file) },
  { id: 'credential-read', sev: 'high',   match: /\.ssh|id_rsa|\.aws\/credentials|keychain/ },
  { id: 'child-process',   sev: 'medium', match: /exec\(|spawn\(|execSync/ },
]
```

- `findings` 全量写入 index（透明）
- `redFlags` = `high` 级命中 —— **两个后果：①强制进入人工队列（quarantine），无论 AI 说什么；②verify 阶段标记 `skipped`，不在沙箱执行**——高危件连 beacon 的机会都不给
- **spike 实证**：bun 默认不执行 postinstall/prepare（需显式 trust）——run 41347310893 实锤 `@opencode/cli's postinstall script was not run`。**注意证据边界**：该实证是"我们用 bun 装 CLI"被拦，opencode 内部 `plugin add` 的装包引擎是否放行生命周期脚本**未单独验证**——所以高危件 `skipped` 规则继续有效，不因 bun 结论放松
- `medium` 级件照常执行（runner 是一次性的、无凭据，装它就是采信号）
- 单元测试：每规则正反样本 + 已知恶意样本 fixture（仿 ua-parser-js 投毒模式）

---

## 4. 实机验证（pipeline/verify）—— P0 门

**启动前必须先过的可行性 spike**（用户硬性要求，不通过即降级/终止）：

```yaml
# .github/workflows/spike.yml（一次性验证脚本，非正式管线）
steps:
  - 装 v2：npm i -g @opencode/cli          # ← 实测唯一正解：官方脚本/bun 都装 v1.19.5
    # 实证：opencode-ai 包装的是 v1（CLI 语义不同会把参数当包名装）；v2 是 @opencode/cli。
    # bun 会拦 postinstall（"postinstall script was not run"），npm 放行——故用 npm 装宿主
  - 隔离用 XDG_CONFIG_HOME+XDG_DATA_HOME+XDG_CACHE_HOME 三件套（不带真实凭据）
    # 实证：不设 XDG 时 add 写真实 ~/.config/opencode/；设了才进隔离目录
  - opencode plugin add opencode-loop-recover   # 正样本（已实证成功）
  - opencode run "hi"（模型挂了无所谓，server 启动即加载插件）
  - grep $XDG_DATA_HOME/opencode/log/opencode.log → 'msg="loading plugin" id=<name>'  # ← 激活信号实证位
  - opencode plugin add nonexistent-pkg-xyz     # 负样本：file:// 不支持，NpmInstallFailedError+404 可断言
  - 断言：正→loading 行出现 + 负→fail + 日志可诊断
```

**canary 信号（已实测定案，本地 oh-my-opencode 实证）**：
- 信号在**日志文件** `$XDG_DATA_HOME/opencode/log/opencode.log`：`msg="loading plugin" id=<name> entrypoint=<path>`（role=server）
- `--print-logs` 在 run 模式不转发 server 日志——**必须读文件不是 stdout**
- 排除项：`plugin list` 不读全局 config；`serve` 干等无插件行
- 负信号格式：WARN `configured plugin path must be a directory`
- 插件落盘位：`$XDG_CACHE_HOME/opencode/npm/<pkg>@latest/<ts>/node_modules/`

**通过标准**：正样本能稳定产生可断言的激活信号 + 负样本 fail + 日志可诊断。
**当前判定**：P0 通过——Level A 可达：canary=`opencode run` 后 grep 日志文件 `loading plugin id=<name>`（本地 oh-my-opencode 实证）。CI 侧仅需确认无模型时 run 仍能走到插件加载（大概率是，server 先加载插件再做模型解析）。
**降级预案**：Level B（只验证 install 成功，不验证激活）→ 标 `level: install`；Level C（纯静态目录）→ 项目按约定重评。

正式验证设计：
- **按类型分级验证**：plugin → install + load（执行）；skill/agent/command → `level: structure`，只校验 SKILL.md/frontmatter 合法性（**不执行**）；mcp → manifest 结构校验；theme → 结构校验
- **高危件不执行**：scan 命中 redFlag → `status: skipped`（§3 已定，这里呼应）
- **增量验证**（防全量重跑超时）：缓存 key = `name@version + opencodeVersion`，只有新版本或宿主升级才重验；全量重验只在缓存失效时发生
- **matrix 分片**：GH matrix 上限 256 job，默认 12 目标/片；片内 `VERIFY_LANES` 条并行 lane（默认 4，上限 8）——lane 是等待型并发（装/serve/轮询烧墙钟不吃 CPU），加宽它是在不增 matrix job 数的前提下提吞吐的主杠杆；`VERIFY_SHARD_SIZE` 可调片大小（默认 12，上限 64）——片大则 job 少但单 job 时长变长（timeout-minutes 要匹配）
- **激活信号取日志文件**（A3 定案）：`opencode run` 后 grep `$XDG_DATA_HOME/opencode/log/opencode.log` 的 `msg="loading plugin" id=<name>`；`plugin check` 只查更新不是激活信号，不用它；失败写 `logExcerpt`（≤2KB）+ `runUrl`
- **本地运行 = 本机执行不可信代码**：`VERIFY_SANDBOX_USER` 未设时，`plugin add`/`serve`/TUI/gui 评估全部以当前 uid 跑（gui 的 `node:vm` 不是安全边界）。shard 驱动对此打印显式警告——verify 是 CI-only 操作；本地只验你已经信任的包。CI 侧边界 = nobody uid + eBPF egress 白名单 + `permissions:{}`。**目录裁决必须产自 CI**——merge 把 `runUrl` 写进 verification 作为可审计出处，本地产出的结果没有可链接出处，不进信任链。

### OPENCODE_VERSION 升版 runbook

宿主大版本升级使**全部** `verified`（hostStale）与**旧宿主 terminal-failed**（hostStaleFail，每次升版一次赦免测量）同时回队——这是结构性爆发，规模 = 可算的 stale 计数。操作流程：

1. `pipeline/publish/merge.ts`：`OPENCODE_VERSION` 改为新版本（verify.yml 的 shard job 从该常量反解析安装宿主版本——两 pin 永不漂移）
2. 量 stale 深度（决定 cap）：
   ```bash
   curl -s <indexUrl> | jq '[.plugins[] | select(
     (.verification.status=="verified" or .verification.status=="failed")
     and .verification.level != "structure"
     and .verification.opencodeVersion != "unknown"
     and .verification.opencodeVersion != "<新版本>")] | length'
   ```
3. `Actions → verify → Run workflow`：`cap` 填 stale 数 + 缓冲 → N/VERIFY_SHARD_SIZE 个 shard job 自动出矩阵
4. 需要更急时设仓库变量：`VERIFY_LANES`（默认 4，上限 8）/ `VERIFY_SHARD_SIZE`（默认 12，片大 = job 少 = 对共享并发更友好，单 job 时长相应变长）
5. 排干窗口期：`verified` 徽章挂的是**旧宿主上的声明**——详情页 `(opencode x.y)` 明示测量宿主；staleHost 层在队列里仅次 submission，优先排干
6. 验收：digest backlog 的 staleHost 计数归零

merge 幂等（verifiedAt 新鲜度守卫 + name@version+verifiedAt 去重），多轮 dispatch/中断重跑安全。

### ai-diagnose 守护 runbook

`bin/ai-diagnose-agent.sh` 是前台常驻守护循环（第三方保活程序监督的进程），每轮：`刷新脚本副本 → 跑一轮 ai-diagnose.sh → 按退出码睡眠`。启动：

```bash
cd <repo> && ./bin/ai-diagnose-agent.sh         # 本地 ornith judge（默认）
cd <repo> && ./bin/ai-diagnose-agent.sh devin   # devin -p 单次会话 judge（AI_BACKEND=devin 透传，覆盖 ai.env）
```

- 节拍：`DIAGNOSE_TICK`（默认 1800s=30min，对齐 hourly catalog 节拍）/`DIAGNOSE_RETRY`（默认 300s，失败自动重试）；`DIAGNOSE_LIMIT=150`、`DIAGNOSE_BUDGET=45min` 控单轮规模
- `DIAGNOSE_LEGACY=1` → 每轮带 `--include-legacy`——legacy 条目（含 legacy github）也进审队列；github pending 条目无条件进（有 `source.version` sha 即有字节锚，缺 sha fail-closed 不入队）
- pipeline 代码跑在 `$CODE`（`~/.local/share/opencode-market-code`，钉 origin/main 的独立 checkout）——每轮 fetch+reset 自同步到最新 main，**你 cd 的 repo 只供 wrapper 脚本**；`$CAT` 是独立 catalog 分支 checkout，互不共享
- 脚本三级刷新源：`$REPO` → `$CODE`（钉 origin/main）→ 本地缓存——外置卷未挂载/开发树脏都照跑
- 网络隔离环境 git 走 `MARKET_GIT_PROXY`（如 `http://127.0.0.1:7890`）——shim 翻译成 `GIT_CONFIG_*` 环境注入覆盖 `~/.gitconfig`
- 远端默认取 repo 的 origin，`MARKET_GIT_URL` 可覆盖
- TERM/INT 转发给当前子进程（轮次或 sleep）后退出——supervisor 可干净重启
- 日志无自带目标，由启动方重定向（`>> ~/Library/Logs/opencode-market/ai-diagnose.log`）
- 数据面开关照旧：catalog 分支 `diagnose.paused` 一落，守护每轮自跳过

---

## 4.5 收录门槛与身份去重（discover 的去水规则）

npm keyword 2876 条大半是垃圾，收录必须过证据门，不是"提到 opencode 就算"：

**来源可审计**：每条候选记录本轮发现渠道（keyword/topic/code-search/topic-list），写进条目 `discoveredVia`——索引可信度的一部分是"你从哪来"可追溯。

**准入（满足其一即候选）**：
- npm 包：`keywords` 命中可配置关键词集（`opencode-plugin`/`opencode`/`opencode-ai` 等，宁可宽收后面证据筛）**且** package.json/入口文件存在插件证据（`exports`/`main` 指向 v2 `{ id, setup }` 形态入口、或 README 声明 `opencode.json` `plugin` 安装方式）——**证据信号不只看 keyword，爬虫要实际拉取 package.json 和入口文件**
- GitHub 仓库：根目录或 `.opencode/plugins/` 下有 v2 `{ id, setup }` 入口文件、或 `opencode.json` 引用了该包
- skill 类：仓库含 `SKILL.md` 且 frontmatter `name`+`description` 合法（来源：GitHub topic `opencode-skill`/`agent-skills` + code search，注意 code search 限流见 §11-B2）
- mcp 类：含 `.mcp.json` 且声明可解析；bundle 类：含 marketplace 清单
- 通用：repo 链接有效且非 archived

**注意**：`.opencode/plugins/` 本地目录插件没有 npm/GitHub 公开产物的话**天然无法被爬取发现**——这类只能靠后续投稿通道（P4），不是 discover 的职责

**排除**：
- 纯 keyword 蹭词（仓库无任何 opencode 产物证据）
- 批量生成的模板包（同 owner 同模板 >5 个、描述雷同——magpie-community 那批的模式）
- 无实质内容的空壳/占位包
- fork 且无自有提交

**身份去重**（同一插件多渠道发布时）：
- 规范身份 = GitHub repo URL；npm 包名作为别名挂在 `source.id`
- npm↔repo 映射：优先 package.json `repository` 字段，其次 README 链接，再次同名启发式（需人工白名单确认，防误并）

---

## 4.6 索引演进、slug 与作者契约

**schema 演进策略**：`version` 只升不回头；**字段只加不改不删**——消费端（站/MCP/官方 source）不许因新字段崩；破坏性变更必须 bump `version` 并保留旧版索引一份（`index.v1.json` 并存一个周期）。

**slug 规范**（URL 稳定是资产）：`owner/repo`；monorepo 子包 → `owner/repo--<subpath 转 - 连字符>`（dsh-market `slugOf` 同款）；无 repo 的 npm-only → `@scope/name` 原样。slug 一生成即不可变，改名只加 `aliases` 数组。

**作者契约**（插件作者怎么配合目录）：
- 兼容声明：`package.json` 写 `engines.opencode: ">=2.0.0"` 或 peerDep `@opencode/plugin` 范围
- 可选元数据：`icon` / `screenshots` / 自述分类建议（目录侧保留最终决定权）
- 过验证：无 postinstall 等高危脚本 → 自动装测；有则进人工队列
- 条目元数据约定文件（可选）：仓库根放 `.opencode-market.json` 声明 category/description 补充——目录爬虫读到即采用，缺失也不影响收录

**README**：仓库根需 `README.md`（项目自述+索引地址+方法论一页）——对外第一张脸，随 P1 一起交付。

---

## 5. 收录站（site/）—— 薄壳

- **技术栈**：Astro 静态站（比 Next 轻、Pages 原生友好、零运行时）
- **页面**：`/`（搜索+列表）、`/p/<slug>`（详情：验证结果/风险标记/兼容性）、`/about`（方法论透明页）
- **搜索**：客户端 substring + 中日韩/拉丁边界切分（抄 `searchScriptBoundary`）——3000 条规模够用
- **渲染铁律**：未扫描/未检出/验证失败/未知各是各的文案；风险标记默认收起、可点开
- **i18n**：先英文，文案层预留 zh

---

## 6. 兼容性判定（抄 dsh-market 模型）

- **事实**：索引只存声明（`engines.opencode` / peer dep 范围）
- **结论**：消费端按当前 opencode 版本现场算（`compatible|incompatible|unknown` + `manifest|undeclared|unavailable`）
- **不缓存结论**——宿主升级零维护（dsh-market `discovery-compatibility.ts` 同款设计）

---

## 7. 开发计划（含验收门）

| 阶段 | 内容 | 验收 | 估时 |
|---|---|---|---|
| **P0 spike** | ~~CI 里 headless opencode 装/验正负样本~~ **✅ 已完成**（6 轮：5×CI+1×本地实锤） | 全过：v2 装法/XDG 隔离/正负样本/canary 判据全部钉死。**结论：Level A 可达**（激活信号在 opencode.log 实证） | — |
| **P1** | repo 骨架（ts+vitest）+ discover（npm keyword+GH topic 去水）+ fetch + scan 规则集 + index.json schema + Pages 发布 | `index.json` 上线，≥50 条真实收录，扫描字段正确区分 scanned/not | ~1.5 周 |
| **P2** | verify 矩阵 job（plan→50包/片×8 verify job `permissions:{}`→merge `contents:write`）+ dummy-provider canary | 全量条目有 verification.status | 🔄 CI 首跑中 |
| **P3** | Astro 收录站（列表/搜索/详情/风险标记/about） | 上线可浏览，诚实文案过审 | ~1-2 周 |
| **P4** | 投稿审核 workflow（issue→CI 扫描→报告评论→人终审） | ✅ 真验（issue #1/#2：正样本/不存在/编辑重投三环全通；findings 截断 30） | ✅ |
| **P5** | **应用内市场插件（解冻，用户要求必做）**：opencode 插件，TUI + Desktop 双端 | 插件装得上、面板能开、搜到条目、装得动 | P2 数据面稳了之后；**P5a spike 先行**（见下） |

**每阶段交付物即增量资产**：P1 后目录已上线，P2 后验证数据开始积累——**任何阶段停了，已交付部分仍有独立价值**。

---

## 8. 测试策略（沿用 dsh-loop-recover 标准）

- **测试覆盖率必须 ≥90%**——vitest `--coverage` 硬门槛写进 CI：`lines/functions/branches/statements ≥ 90`，不达标 fail 合入；只有 workflow glue（yml、发布脚本）豁免，业务代码全算基数
- **所有功能带单测**——vitest，规则/解析/schema/搜索全覆盖
- **真实样本回归**：fixtures 存已知坏包（缺 main、.ts 入口、含 postinstall、混淆、字面 IP），断言 findings 命中
- **负样本管线测试**：verify 断言 fail 而非 false-pass——`plugin add` 不支持 file://（A2 实证），负样本用假 npm 名（`NpmInstallFailedError`+404）或 git specifier 坏包；scan 层 fixture 仍用本地 tarball/包目录（scan 不经 opencode）
- verify 链路本身只能 CI 侧验证（本机不跑陌生装测）——本地单测覆盖到 scan/fetch/schema，verify 的行为验证放在 workflow 自测 job
- **无 mock 原则**：扫描用真 tarball fixture，装测用真 CI job
- **CI 自检**：workflow 里 lint+typecheck+test 三关

---

## 9. 运营设计（上线后）

```
定时 agent 每日巡检 CI（挂了自诊断+修+PR）
干净条目自动进索引（无人工）
风险件 → quarantine（不阻塞，作者催由 AI 答"审核中"）
每周 digest → 人 2 分钟心跳抽查
```

目标：**日常零人工**；人只处理申诉/纠纷/季度复盘。

---

## 10. 不做清单（防止范围蔓延）

- 不做 MCP 本体收录（只做兼容性标注）
- 不做用户账号/评论/点赞（cafe 死因之二：重功能低内容）
- ~~不做应用内市场 UI~~ → **P5 已解冻**（用户裁定：不内嵌就没意义）

**P5 形态（upstream 源码实证，2026-11-02）**：
- **TUI 端**：`@opencode/plugin/tui` — `context.ts` 暴露 panel(`ui.panel.open`)/dialog/command palette/slash 命令/keymap/toast。形态：`/market` 命令 + 面板浏览/搜索 index.json + 选中即 `opencode plugin add`
- **Desktop 端**：`@opencode/plugin/gui` — 完整 SolidJS 组件面，`registries.ts` 有 PanelTab/`session.panel` 菜单/server 菜单/commands/MobileView；宿主加载插件包 `./gui-experimental` 入口；样板：`packages/plugin-browser`
- **P5a spike（先行验证项）**：①~~第三方 GUI 加载~~ ✅ 已实证（2026-11-02 源码链路确认：`plugin add` 装的包带 `exports["./gui-experimental"]` → core 解析→service 下发→app evaluatePluginBundle；白名单 require：solid-js/@opencode-*/effect/client，其余依赖须打进 bundle）②SolidJS+vite 单文件构建链跑通 ③面板最小 demo 真机渲染。不过 → TUI-only 降级
- **风险**：两个 SDK 都是 v2 实验面（`./gui-experimental` 命名自带警告），跟随上游变动——P5 代码与 SDK 版本探测解耦（C4 同款处理）
- 不做遥测（信任原则，沿用 dsh-market "No telemetry"）
- 不做付费层（占位期不考虑）

---

## 11. 卡点清单（所有已知阻塞点，按阶段列）

### A. P0 硬卡点（spike 6 轮全部验证完：5×CI 至 run 41348320405 + 1×本地 oh-my-opencode 实锤）
| # | 卡点 | 判定 | 证据 |
|---|---|---|---|
| A1 | 无头环境需 provider/auth | ✅ **解** | CI 里 `plugin add` 无凭据直接成功——插件管理不需要模型/auth |
| A2 | `plugin add` 行为 | ✅ **解** | 非交互可用；但 **`file://` 不支持**（"must be an npm registry package or Git specifier"）——负样本用假 npm 名（`NpmInstallFailedError`+404 可断言） |
| A3 | canary 激活信号 | ✅ **解（真信号找到）** | 本地实装 oh-my-opencode 实证：`opencode run` 起 server 即加载插件，信号在 **`$XDG_DATA_HOME/opencode/log/opencode.log`**：`msg="loading plugin" id=<name> entrypoint=<path>`（--print-logs 不转发，须读日志文件）。负信号：WARN `configured plugin path must be a directory`。隔离用 `XDG_*` 三件套 |
| A4 | SDK 包名 | ✅ **解** | `@opencode/plugin`（loop-recover peerDep 实证） |
| A5 | bun postinstall | ✅ **解** | bun 默认拦生命周期脚本（`@opencode/cli` 装失败实证）；npm 放行——**verify 用 npm 装宿主时高危件 `skipped` 规则仍必须** |
| A6 | CI 装 v2 的方法 | ✅ **解** | **`npm i -g @opencode/cli` = v2.2.5 唯一正解**；官方 install 脚本和 `bun i -g opencode-ai` 都装 v1.19.5 |

### B. 数据卡点（P1 发现期）
| # | 卡点 | 应对 |
|---|---|---|
| B1 | npm search API 分页上限（~250/页、总量封顶） | 拆多关键词+时间窗组合查询，别指望一次拉全 |
| B2 | GitHub code search 找 SKILL.md 需 auth、限流严（~10/min） | 慢速排队+增量缓存；主力走 topic 不靠 code search |
| B3 | npm↔repo 映射准确率（repository 字段常缺失/指错） | 误并=目录信誉事故，启发式映射默认进人工白名单确认 |
| B4 | skill 类条目无 npm 存在，量级未知 | 先收 plugin 跑出形态，skill 源后扩 |

### C. 规模卡点（P2 验证期+上线后）
| # | 卡点 | 应对 |
|---|---|---|
| C1 | Actions fair-use 配额：~500 包×每日装测的分钟数 | 增量验证（已有）；仍超额则降频为隔日 |
| C2 | index.json 体积增长 → 客户端全量加载 | gzip 1-2MB 内可接受；超了分层索引（先摘要页再详情） |
| C3 | jsdelivr 缓存不可控（分支代理强缓存） | 索引主源以 Pages 为准，jsdelivr 只作冷备；消费者文档注明 |
| C4 | opencode API churn（v2 实验期）→ verify harness 周期性 break | 运营期最大持续成本；verify 代码与版本探测解耦，破的时候降级不崩 |

### D. 运营卡点
| # | 卡点 | 应对 |
|---|---|---|
| D1 | quarantine 积压无人兜底 → 合法件永 pending | 申诉通道（issue 模板）+ 每月人工清队 |
| D2 | AI 诊断需 LLM API key（P4 才引入 secret） | key 只进 P4 job，verify job 永无 secret。**本地开发端点**：`http://localhost:8001`，key/模型名放 `~/.config/opencode-market/ai.env`（不入库——判官身份公开=邀请针对性规避） |
| D3 | 官方市场（dobord PR）落地时点未知 | P5 已解冻（用户裁定必做）；catalog 按 source 格式设计，官方落地时可转为其数据源而非废弃 |
| D5 | ~~GUI SDK 第三方加载~~ ✅ 已实证可行 | 剩风险：`experimental` 面随上游变 + 依赖必须全打进 bundle（白名单 require） |
| D4 | spam/恶意投稿 | P4 才开投稿；此前目录全由爬虫决定 |

### E. 信任卡点
| # | 卡点 | 应对 |
|---|---|---|
| E1 | 规则集公开 = 恶意作者可针对性绕过 | 分层：扫描+装测+人工高危审；诚实标"未检出≠安全" |
| E2 | typosquatting/改名包冒充知名插件 | 名称相似度检测 + 官方 ecosystem 名单锚定 |
| E3 | fork 包冒名原插件身份 | §4.5 去重规则：无自有提交的 fork 不收 |
| E4 | catalog 分支写通道不止 CI：maintainer Mac 的常驻守护（`bin/ai-diagnose-agent.sh` 前台循环拉起 `bin/ai-diagnose.sh`，第三方保活监督；另有手动 `bin/publish-digest.sh`）以本地 git 凭证推送，无 egress/permissions 护栏——Mac 失陷或恶意 merge 到 main，下一周期即带写权限执行 | 与 CI secret 同级信任根：`$CODE` 钉 `origin/main` 独立 checkout（脏树不会被跑）；视为数据面第三信任根纳入威胁模型（另两根：GITHUB_TOKEN、GitHub Pages 账号） |

### F. 治理卡点
| # | 卡点 | 应对 |
|---|---|---|
| F1 | `opencode.market` 域名含完整商标，远期有被主张风险 | 备选不带商标名；页脚 not-affiliated 声明 |
| F2 | 60 天仓库无活动 → 定时 workflow 被 GitHub 停用 | catalog 分支 commit 自带活性（§1 已解） |
| F3 | 生态死亡（opencode 没了） | 格式中立目录，数据可平移（RESEARCH §5） |

---

## 12. 起步清单（下一步具体动作）

1. ~~`git init` + `.gitignore` + `package.json`~~ ✅ 已做（骨架+spike.yml 在 spike 仓库已验）
2. ~~先写 spike.yml 推上去跑~~ ✅ **P0 已过**（6 轮，全卡点有结论）
3. **进 P1**：把 spike 仓库骨架转正——ts+vitest 项目结构、coverage ≥90% 门槛写进 vitest.config + CI、然后开始 discover 模块
4. P1 顺序：schema/types 先行 → discover（npm keyword+去水）→ fetch → scan 规则集 → index.json 生成 → Pages 发布

---

*P0 判定门已过（Level A 可达）。下一步 P1：骨架转正 + discover 模块。*

## 验收结果（2026-11-02 全绿）

| 阶段 | 结果 |
|---|---|
| P1 管线 | 496 条目收录、index.json + 详情页 Pages 上线 |
| P2 verify | **366/366 全量真验完成**：309 verified、57 failed（真失败=装不上/加载挂）、130 redFlag skipped；plan→8 分片（permissions:{}）→artifact→merge→catalog→site→Pages 全链实测通过 |
| P3 站 | 列表+详情页，验证状态实时展示（serve+API 懒加载触发方案） |
| P4 投稿链 | issue 开/改→自动 review 评论→重评，三场景真验 |
| P5a 市场插件 | TUI `/market` + Desktop Market 面板双端真数据、搜索+安装 |

verify 关键坑（见 BLOCKERS.md）：插件懒加载需 API 请求触发；run 的 service 派生在 CI 卡死换 serve；macOS 不吃 XDG；分片 96/8 片适配并发。

## verify 失败归类（2026-11-02，366 全量）

| 类别 | 数量 | 说明 |
|---|---|---|
| install 失败 | 6 | `NpmInstallFailedError`/404——包不存在或装不上，真负样本 |
| load 失败 | 51 | 装好但无 `loading plugin` 日志行：eval 崩/入口坏/opencode 版本不兼容；日志核对无 id 误杀 |
| verified | 309 | 真装上+真加载 |
| skipped | 130 | redFlag 跳过执行（安全设计） |

failed 数据已留档 catalog；本地复查 `pipeline/verify` 可在隔离 env 重跑单包定位。

## 运维备注

- catalog.yml cron `0 3 * * *` 已配置，自然触发未观察（均手动 dispatch 实证）
- macOS 本地 verify 读真实 `~/.config`（opencode 不吃 XDG）——仅本地，CI Linux 正常，见 BLOCKERS.md
- npm 包 `oc-market-quail-zephyr-72a0`（随机名实测分发链）：0.0.1 已转正可装，hex 随机名触发 npm spam 检测须用词组名

## 仓库定位（2026-11-04 迁移后）

- **dev** = `terry2010/awesome-opencode-market`(fork)——定时任务在这跑,
  catalog/Pages/review issue 都是 dev 数据。
- **prod** = `awesome-market/awesome-opencode-market`(组织仓)——Actions 常关,
  抓取机制调好并在 fork 验证后才开;`main` 走 PR(catalog 分支不受影响)。
- **spike** = `terry2010/opencode-market-spike`——Actions 已禁,仓库与 Pages
  留作化石,不再维护。细节见 `docs/MIGRATION.md`。

(原 2026-11-02 定位:spike 为测试专用库、上线另建库——已由 fork/prod
分工落地。)

## load-failed 逐包归因（51 条）

- 7 条 `NpmInstallFailedError`（404/装不上——真不存在或私有）
- 44 条装好但 server 无 `loading plugin` 行：eval 崩/入口缺/opencode 版本不兼容
  （抽样核对：日志无 id 误杀、无网络挂——server 正常 boot 仅该包静默）
- 全部已留档 catalog `verification.logExcerpt`，逐包可查

## 追加（2026-11-02 P0+补齐批次）

- **i18n-lite**：`catalog.ts t()` zh/en 用户面字符串（status/搜索/返回/加载中）——自动按 navigator.language 切
- **目录 TTL 缓存**：`fetchIndexCached` 1h TTL + localStorage 快照回退（dsh registry.ts 模式）+ 页头 `indexAge` 新鲜度标识
- **装后生效确认**：add 成功后重拉 `plugin list` 复核+提示 "restart to activate"（server 插件需服务重启——与 dsh hot mount 的宿主差异）
- **更新链**：`hasUpdate` 版本对比，已装条目显示 `update → vX` 按钮（re-add latest 语义）
- **build 脚本放行**：opencode `plugin add` 的 preinstall 拦截现在没有 UI 出路（宿主限制）——失败时 stderr 关键行+导出日志已是最远一步；放行是宿主层面的特性需求，记档待 opencode 侧出 API
- **npm CDN 分发**：index.json 可挂 `oc-market-quail-zephyr-72a0` 包内 `files`（后续 publish 带上——jsdelivr 15s 源比 Pages 稳）；当前实现未启用，记档
- **e2e 宿主冒烟**：`scripts/e2e-host-smoke.sh`——隔离 env 起 serve+打 API 验 `loading plugin` 行，可在 CI 外快速自检
- **产品规约**：`AGENTS.md` 已立（借 dsh 框架）
