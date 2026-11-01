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
│   5. publish    — 生成 index.json → commit 到 catalog 分支 │
│                   （索引 diff 历史 = 公开审计轨迹 +         │
│                    自带仓库活性，化解定时workflow 60天禁用）│
│                   → 防损闸：新索引条目数 <上次的 80%        │
│                     或为空 → 拒发并告警（dsh-market 同款）  │
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
      "source": { "kind": "npm",            // npm|github——GitHub-only 条目无 npm 字段
                  "id": "opencode-loop-recover",
                  "repo": "terry2010/opencode-loop-recover" },
      "description": { "en": "...", "zh": "..." },
      "category": ["safety", "context"],   // 功能分类，多个按序
      "license": "MIT",
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
        "peer": "@opencode/plugin@^2"       // 或 peerDependencies 上的宿主 SDK 包
                                            // TODO(P0)：核实 opencode 插件 SDK 的真实包名
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
  { id: 'postinstall',     sev: 'high',   match: /"(pre|post)install"/ },
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
- **spike 实证修正**：opencode v2 经 bun 安装，**bun 默认不执行 postinstall/prepare（需显式 trust）**——spike run 41347310893 实锤 `@opencode/cli's postinstall script was not run`。含义两面：①CI 装恶意包时 postinstall 大概率根本跑不起来，攻击面比预想小；②"装测成功"≠"生命周期脚本跑过"，verify 语义要分清"包文件落盘"和"脚本执行"两层
- `medium` 级件照常执行（runner 是一次性的、无凭据，装它就是采信号）
- 单元测试：每规则正反样本 + 已知恶意样本 fixture（仿 ua-parser-js 投毒模式）

---

## 4. 实机验证（pipeline/verify）—— P0 门

**启动前必须先过的可行性 spike**（用户硬性要求，不通过即降级/终止）：

```yaml
# .github/workflows/spike.yml（一次性验证脚本，非正式管线）
steps:
  - 安装 bun + v2 CLI：bun install -g @opencode/cli && bun pm trust @opencode/cli
    # 实证：opencode-ai 包装的是 v1（CLI 语义不同会把参数当包名装）；
    # v2 是 @opencode/cli，且 postinstall 必须显式 trust 否则报 "postinstall script was not run"
  - 造隔离 HOME（不带真实凭据）
  - opencode plugin add opencode-loop-recover   # 正样本（canary 见下）
  - 启动 opencode server，抓 canary 信号          # ← 不是"看日志"这么虚
  - opencode plugin add file://./test/fixtures/broken-plugin  # 负样本：本地 fixture，不用发 npm
  - 断言：正→pass + 负→fail + 日志可诊断
```

**canary 信号怎么拿（spike 的核心不确定项，三选一实测出哪个可靠就用哪个）**：
- a) 插件 setup() 里写一行固定 marker 到 stderr/日志——用我们自己的 loop-recover 加一个 `OPENCODE_PLUGIN_LOADED` 打印（最可靠，但要插件配合）
- b) `opencode plugin list` / `plugin check` 输出里能不能看到激活状态（不依赖插件配合，通用）
- c) 起一个需要插件 hook 的 session 看 hook 有没有被调（最强证据但最重）

先在本机跑通（opencode 已装、正负样本都在手里）再上 CI——本地迭代比 CI roundtrip 快一个量级。

**通过标准**：正样本能稳定产生可断言的激活信号 + 负样本 fail + 日志可诊断。
**降级预案**：Level B（只验证 install 成功，不验证激活）→ 标 `level: install`；Level C（纯静态目录）→ 项目按约定重评。

正式验证设计：
- **按类型分级验证**：plugin → install + load（执行）；skill/agent/command → `level: structure`，只校验 SKILL.md/frontmatter 合法性（**不执行**）；mcp → manifest 结构校验；theme → 结构校验
- **高危件不执行**：scan 命中 redFlag → `status: skipped`（§3 已定，这里呼应）
- **增量验证**（防全量重跑超时）：缓存 key = `name@version + opencodeVersion`，只有新版本或宿主升级才重验；全量重验只在缓存失效时发生
- **matrix 分片**：GH matrix 上限 256 job，按 50 包/片分批串行；每片超时 5min/包
- 抓 `opencode plugin check`（v2 自带）+ 启动日志双重信号；失败写 `logExcerpt`（≤2KB）+ `runUrl`

---

## 4.5 收录门槛与身份去重（discover 的去水规则）

npm keyword 2876 条大半是垃圾，收录必须过证据门，不是"提到 opencode 就算"：

**准入（满足其一即候选）**：
- npm 包：`keywords` 含 opencode-plugin **且** package.json/入口文件存在插件证据（`exports`/`main` 指向 v2 `{ id, setup }` 形态入口、或 README 声明 `opencode.json` `plugin` 安装方式）——**证据信号不只看 keyword，爬虫要实际拉取 package.json 和入口文件**
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
| **P0 spike** | spike.yml：CI 里 headless opencode 装/验正负样本 | 正 pass + 负 fail + 日志可读。**不过即停** | 0.5-1 天 |
| **P1** | repo 骨架（ts+vitest）+ discover（npm keyword+GH topic 去水）+ fetch + scan 规则集 + index.json schema + Pages 发布 | `index.json` 上线，≥50 条真实收录，扫描字段正确区分 scanned/not | ~1.5 周 |
| **P2** | verify 矩阵 job（隔离/超时/日志抓取）+ 结果入索引 | 全量条目有 verification.status，失败条带日志 | ~1-2 周 |
| **P3** | Astro 收录站（列表/搜索/详情/风险标记/about） | 上线可浏览，诚实文案过审 | ~1-2 周 |
| **P4** | 投稿审核 workflow（PR→CI→AI 诊断→人终审） | 模拟 PR 走通全链 | 后置 |
| **P5** | 应用内市场插件 | 看官方市场动向再定 | 冻结 |

**每阶段交付物即增量资产**：P1 后目录已上线，P2 后验证数据开始积累——**任何阶段停了，已交付部分仍有独立价值**。

---

## 8. 测试策略（沿用 dsh-loop-recover 标准）

- **测试覆盖率必须 ≥90%**——vitest `--coverage` 硬门槛写进 CI：`lines/functions/branches/statements ≥ 90`，不达标 fail 合入；只有 workflow glue（yml、发布脚本）豁免，业务代码全算基数
- **所有功能带单测**——vitest，规则/解析/schema/搜索全覆盖
- **真实样本回归**：fixtures 存已知坏包（缺 main、.ts 入口、含 postinstall、混淆、字面 IP），断言 findings 命中
- **负样本管线测试**：verify 断言 fail 而非 false-pass——`test/fixtures/broken-plugin` 为本地坏件，走 `file://` 协议喂给 verify，**不用为测试专门发 npm 包**
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
- 不做应用内市场 UI（P5 冻结，看 dobord PR 走向）
- 不做遥测（信任原则，沿用 dsh-market "No telemetry"）
- 不做付费层（占位期不考虑）

---

## 11. 卡点清单（所有已知阻塞点，按阶段列）

### A. P0 硬卡点（spike 必须回答，答不出即降级/终止）
| # | 卡点 | 为什么是卡点 |
|---|---|---|
| A1 | **opencode 无头启动是否需要模型 provider/auth** | 若 server 无 API key 起不来，整套"装插件看激活"在 CI 里成立不了——**最大单点风险** |
| A2 | `opencode plugin add` 在 CI 的行为未知 | 是否交互式、是否支持 `file://`、是否需要 server 在线——决定 spike 脚本怎么写 |
| A3 | canary 激活信号是否存在 | a/b/c 三案均未验证；若主机不提供任何可观测激活信号，只能降到 Level B |
| A4 | 插件 SDK 真实包名未核实 | `@opencode/plugin` vs `@opencode-ai/plugin`——写错则 compat 判定全错 |
| A5 | bun install 默认是否执行 postinstall | 影响两端语义：verify"装成功"是否真的经过生命周期脚本；高危件 `skipped` 的必要性 |

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
| D2 | AI 诊断需 LLM API key（P4 才引入 secret） | key 只进 P4 job，verify job 永无 secret |
| D3 | 官方市场（dobord PR）落地时点未知 | P5 冻结；catalog 按 source 格式设计保持可接入 |
| D4 | spam/恶意投稿 | P4 才开投稿；此前目录全由爬虫决定 |

### E. 信任卡点
| # | 卡点 | 应对 |
|---|---|---|
| E1 | 规则集公开 = 恶意作者可针对性绕过 | 分层：扫描+装测+人工高危审；诚实标"未检出≠安全" |
| E2 | typosquatting/改名包冒充知名插件 | 名称相似度检测 + 官方 ecosystem 名单锚定 |
| E3 | fork 包冒名原插件身份 | §4.5 去重规则：无自有提交的 fork 不收 |

### F. 治理卡点
| # | 卡点 | 应对 |
|---|---|---|
| F1 | `opencode.market` 域名含完整商标，远期有被主张风险 | 备选不带商标名；页脚 not-affiliated 声明 |
| F2 | 60 天仓库无活动 → 定时 workflow 被 GitHub 停用 | catalog 分支 commit 自带活性（§1 已解） |
| F3 | 生态死亡（opencode 没了） | 格式中立目录，数据可平移（RESEARCH §5） |

---

## 12. 起步清单（下一步具体动作）

1. `git init` + `.gitignore` + `package.json`（type:module, vitest）
2. 目录骨架：`pipeline/{discover,fetch,scan,verify,publish}/`、`site/`、`test/fixtures/`、`.github/workflows/`
3. **先写 spike.yml 推上去跑**——这是唯一硬门槛
4. spike 通过后按 P1 顺序开工

---

*立项就绪。第一步 spike 是项目存续与否的判定门。*
