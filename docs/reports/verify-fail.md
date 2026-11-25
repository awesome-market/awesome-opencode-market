# 装测失败日报 — 2026-11-25

> 机械装测测量结果，**不是安全判定**：verify 管线实测"装不上/加载失败"的条目。
> 这些条目不再逐条开 issue——翻案靠重测转 verified 或人工 verdict；条目离开本表即翻案成功。

## 汇总
- 当前装测失败条目：**125**
- 按阶段：**install** 67 · **load** 46 · **structure** 9 · **render** 2 · **interactive** 1
- AI 判过但装不上：**244**（判词有效、字节装不上——同样等重测/上游修复翻案，见第二表）

## 明细
| 包 | 版本 | 阶段 | 原因摘要 |
|---|---|---|---|
| @elixcode/elixcode-bun | 0.9.4 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: @elixcode/elixcode-bun@0.9.4 |
| agiledon/openmole | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install agil |
| agirahman/righthand | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install agir |
| aideveloper1976-arch/agentic-sdlc | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install aide |
| aimeoa/hanshuang-codex | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install aimeoa/hanshuang-codex#cf9c1537c2bd4ed8577ed6509ee665a39709d7d4: git dep preparation faile |
| Akshat-2011/vibe-wise-opencode | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: Akshat-2011/vibe-wise-opencode#07154ac85cd7fad1f88ccdfb3d06ad04a45f22e0 |
| alvarolorentedev/opencode-mobile | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install alva |
| amadeus-ex-machina/christina | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: amadeus-ex-machina/christina#d6320bbb9d189c12814b3a83dc26cb74dfc8adf0 |
| AmethystLuna/embedded-workbench | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Amet |
| anandpant/opencode-palantir | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: anandpant/opencode-palantir#a8ffe2b9e8aac3b5380d3db3eec34ad3414f1f47 |
| anargia-pixels/opencode-automode-plugin | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install anar |
| AnotiaWang/opencode-web-plugin | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Anot |
| apelabs-dev/sur9e | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install apelabs-dev/sur9e#303edc6f14a7bdc3e8e377a8ec338f450d8b2e7a: git dep preparation failed |
| Ar5en1c/localqa | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: Ar5en1c/localqa#fe4891f61c8c16b9dc69e223bfa2d3228655933a |
| arthurfiorette/opencode-super-sessions | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install arth |
| ashutoshrathi0909-oss/everything-claude-code | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install ashu |
| ATLAS-DEV78423/AgentBridge | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install ATLA |
| atman-33/multi-agent-ff15 | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: atman-33/multi-agent-ff15#1d30afc6c5dfbf0734cba4f3b3a9b9de56909fa6 |
| AVIDS2/memorix | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install AVID |
| avinash-1707/Myrios | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install avin |
| aydemir/opencode-plugins | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install ayde |
| ayushnandi718-dev/opencode-chat | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install ayus |
| B-A-M-N/opencode-xgoal | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install B-A- |
| balatD/gorc | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bala |
| bastian-seifert/armin | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install bastian-seifert/armin#ecb3b61fb3124ea238fd0e6d8558a18a528eecbf: Could not read package.jso |
| batuhansk/opencode-talk | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install batu |
| bbingz/polycli | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bbin |
| benjaminshafii/digital-empire | — | install | [sandboxed egress is allow-listed — an install fetch failure can be network policy, not a broken package] |
| berenddeboer/ready-for-agent | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bere |
| betterspec/opencode-betterspec | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bett |
| beydemirfurkan/opencode-gladio | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install beyd |
| BITRATE-Labs/vrchat-mcp | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install BITR |
| BlakeHastings/opencode-litellm | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Blak |
| Bouska/opencode-dcg-plugin | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Bous |
| br4zz4/opencode-smart-session-picker | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install br4z |
| BrainerVirus/workit | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Brai |
| buddy-hq/buddy | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install buddy-hq/buddy#88e972bb13d33d10dfad7bec0d81cb465ef3c4bc: git dep preparation failed |
| bulga138/peso | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bulg |
| cbartens/bkit | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install cbartens/bkit#56363678d784bc2615e1785a39f152b550bce67d: git dep preparation failed |
| chncaesar/opencode-plugin-memory | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install chnc |
| cosminfuica/opencode-prompt-optimizer | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install cosm |
| devshaydez/seira | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install devs |
| gotenksIN/opencode-websearch-addons | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install gote |
| hamzasoussi53/opencode-island | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install hamz |
| heyimteee/ensemble | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install heyi |
| IgorGanapolsky/ThumbGate | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Igor |
| itsmeadarsh2008/opencode-senses | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install itsm |
| joe-broadhead/opencode-inference | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| kunickiaj/codemem | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install kuni |
| leohenon/opencode-vim-plugin | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install leoh |
| lichenzhao060507/opencode-tavily-proxy-quota | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install lich |
| Looted/kibi | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install Looted/kibi#19da7325c3857acb614c8039346b84ba53cdc2fa: git dep preparation failed |
| marcusrbrown/systematic | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install marc |
| Mte90/opencode-auto-resume | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Mte9 |
| rsshub | 1.0.0-master.501aa77 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install rsshub@1.0.0-master.501aa77: An unknown git error occurred |
| rynfar/meridian | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install rynf |
| seaweeduk/opencode-sleep-inhibit | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install seaw |
| slkiser/opencode-quota | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install slki |
| terry2010/opencode-loop-recover | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install terr |
| thejohnd0e/opencode-answer-date | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install thej |
| Thomashighbaugh/buchbinder | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Thom |
| tickernelz/opencode-mem | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install tick |
| ultus-net/opencode-workflow-guard | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install ultu |
| YonCZ/rich-opencode | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install YonC |
| yuhp/opencode-models-discovery | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install yuhp |
| yurgeno/saut | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: yurgeno/saut#a456c9620151fdb7dfceb5034790cf3f539cba73 |
| zufall-upon/Sortie-dogs | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install zufa |
| yriveiro/spectre | — | interactive | tre-9041134d3a98e9ef25f23555729c41702e48414e/skills/definitions/pr-canvas/SKILL.md, spectre-9041134d3a98e9ef25f23555729c41702e48414e/skills/definitions/principl |
| @alvarovfon/opencode-agent-monitor | 1.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @bloodf/opencode-claude-mem | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @codemcp/workflows-opencode | 6.24.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @crixue/opencode-voice-stt | 0.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: storage.store is not a function. (In 'storage.store(\"state\", { |
| @dendaio/opencode-9router-plugin | 1.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @deveco-test/deveco-harness | 0.2.0-test.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @devtheops/opencode-plugin-mempalace | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @dmmop/opencode-key-rotator | 2.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: Schema.isStartsWith is not a function. (In 'Schema.isStartsWith( |
| @gfn-cis/opencode-temp-sanitize | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: EACCES: permission denied, mkdir '/tmp/opencode/home-753855bc')]) |
| @ghilteras/opencode-model-fallback | 0.4.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gitawego/opencode-vision | 0.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gitgen/gitgen | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @grandmaster451/kilo-superpowers | 2026.317.816 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @heretek-ai/godot-testkit | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mixio-pro/mixiocode-plugin | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @oh-harness/plugin | 0.2.0-test.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @oxel40/opencode-model-groups | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| 3294798852/magpie-musework-plus | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| agent-data/job-search | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| agentic-remem | 0.2.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| alexmarco/opencode-skill-pulse | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| alkevintan/opencode-advisor | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| alkevintan/opencode-vision | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| andyzasl/opencode-copilot | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: undefined is not an object (evaluating 'context.data.on'))]) |
| anis-dr/opencode-mermaid-renderer | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| Ansh-Sonkusare/jev-compaction-harnesses | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| arfoux/rs-guard-v1 | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| aryasaatvik/opencode-plugin-executor | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Cannot load \"effect/dist/unstable/http/index.js\" from plugin node_ |
| Asno-dev/apex | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| autosquid/omo-mem | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| Barathaner/paul-persistent-atlassian-undestanding-meeting-logger | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| benskls/openstrat | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bhumitschaudhry/Slopnought | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| BowTiedSwan/opencode-video-gateway | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bsosik1/opencode-arcana | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| clew-code | 0.11.0 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown option '--port' |
| goodtome/magpie-teleagent-login | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| llisa | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-gemini-web | 0.17.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| oc-codex-multi-account | 1.0.20 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| oh-my-china | 1.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-agy | 0.16.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-fleetview | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-format-lint | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-google-search | 0.1.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| P-Core-System/pcore-orchestra | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @rizal72/oc-git | 0.2.4 | render | gui setup: Unknown error (cause: Cannot read properties of undefined (reading 'catch')) |
| alexandr777git/opencode-session-tokens | — | render | gui render: Panel.render threw: Unknown error (cause: d(...).toFixed is not a function) |
| adriansoriacastellano/hitl-analytics-team | — | structure | 63f56866139f7c87ddf38b29b/.agents/skills/skill_build_marts_layer/SKILL.md, hitl-analytics-team-e529082c885d23863f56866139f7c87ddf38b29b/.agents/skills/skill_bui |
| agisota/old-one | — | structure | (无日志摘录) |
| ArkFlame/FlameWM | — | structure | (无日志摘录) |
| ashikonik/skills-library-mcp | — | structure | (无日志摘录) |
| bthavanish/demiurge | — | structure | no parseable SKILL.md frontmatter in bthavanish/demiurge#3bd448bb56d7cee99fbbf9eea35991446e3286fd (checked 12: demiurge-3bd448bb56d7cee99fbbf9eea35991446e3286fd |
| dilanrojas/dotfiles | — | structure | (无日志摘录) |
| NeoMei/SuperWagie | — | structure | (无日志摘录) |
| openchamber/openchamber | — | structure | (无日志摘录) |
| wangyufengsky/agent-workflow | — | structure | (无日志摘录) |

## AI 判过但装不上
| 包 | 版本 |
|---|---|
| @alex123bob/opencode-cache-stats | 1.5.0 |
| @austinthesing/magic-shell | 1.2.3 |
| @basicbit/vrchat-mcp | 0.1.17 |
| @clicktocode/core | 0.3.3 |
| @ctliz/agent-intercom-opencode | 0.14.0 |
| @cultivx/codereach | 0.2.39 |
| @darknesskiller/opencode-cliproxyapi | 0.4.0 |
| @grinev/opencode-telegram-bot | 0.28.0 |
| @guru.prasath/model-opencode | 0.1.0 |
| @happycastle/opencode-litellm | 0.8.0 |
| @helldinhow/sdd-flow-opencode-plugin | 0.6.16 |
| @howaboua/opencode-roadmap-plugin | 0.2.1 |
| @jack-yang/opencode-quota | 4.11.1 |
| @jacob-z/opencode-token-usage | 0.1.0 |
| @justmpm/agent-runner | 0.10.1 |
| @kimchi-dev/opencode-kimchi | 1.0.6 |
| @mark_future_ai/opencode-buddy | 1.1.2 |
| @mcrescenzo/opencode-workflows | 0.2.0 |
| @mingzzz/ocx-wechat-control | 0.2.6 |
| @nano-step/oh-my-harness | 1.2.5 |
| @niebaopeng/ocusage | 1.0.6 |
| @npll/omol | 5.0.0-beta.6-omol.202608120621 |
| @omniroute/opencode-plugin | 0.2.2 |
| @omniroute/opencode-plugin-v2 | 0.1.1 |
| @openpets/anthropic | 1.0.4 |
| @paflopes/opencode-qwen-auth | 0.0.7 |
| @pathrule/opencode | 1.0.8 |
| @privacypillar/pii-shield-opencode | 0.0.1-alpha.6 |
| @redivo/opencode | 1.2.2 |
| @scrylog/opencode-plugin | 0.9.3 |
| @sublang/cligent | 0.40.0 |
| @sunerpy/oh-my-openagent | 4.21.0 |
| @supanadit/morse-web | 0.31.0 |
| @super-pocock-ai/suite | 2.3.30 |
| @vicoa/opencode | 0.2.1 |
| @wolfx/oh-my-openagent | 4.19.0 |
| @xeedio/prompt-plumber | 0.6.0 |
| @yourlocalai/your-local-ai | 0.1.5 |
| @yoyoyoake/pi-token-plan-monitor | 0.2.3 |
| 00bx-photoshop-mcp | 1.1.2 |
| 199084/opencode-relay-pool | — |
| 1cyberlangke1/my-opencode-toolkit | — |
| 4nkitd/opencode-workspace-sidebar | — |
| 6yte96/freebuffet | — |
| 81ueman/relay | — |
| 897243839/dream-RSI-memory | — |
| a-saeedia/bource-mcp | — |
| aahljhljhlj-ux/opencode-session-analyzer | — |
| aaronpiipponen/opencode-keepalive | — |
| Adamkadaban/opencode-package-managers-hook | — |
| adamtrepka/token-fence | — |
| adyoi/mcp-rag-memory | — |
| afwlehmann/opencode-worktree-plugin | — |
| agent-security-policies | 1.5.7 |
| agentjoey/opencode-remote-control | — |
| agyforclaude | 0.0.3 |
| ai4nucleome/BioMaster | — |
| Alaye-Dong/opencode-hud | — |
| aleks-spv/opencode_retrypush | — |
| alexandru/opencode-session-todo | — |
| AlexisBalayre/agentspine | — |
| alibaba/loongsuite-pilot | — |
| ameshkov/opencode-sdd | — |
| aminammar1/ai-persona | — |
| anaskhan96/opencode-plugin-codex-usage | — |
| AndresArzamendia/Pastoral | — |
| anthropic-multi-auth | 0.1.1 |
| APLaS-Plus/opencode-autoguard | — |
| Arsxxi/iterative-dev-workflow | — |
| artemy/semaphore | — |
| artificial-code-cli | 0.7.0 |
| askferret/automatic-waffle | — |
| avivgerz-hue/ghost-qa | — |
| ayzitix/quanta | — |
| BB-84C/bgs-modding-superpowers | — |
| belambert/opencode-livetrace | — |
| best-radar/bradar-ECC | — |
| best-radar/bradar-ponytail | — |
| bitIO/opencode-provider-balance | — |
| bsmnt | 0.26.1 |
| Builderstar/opencode-v1.18.21-custom-snapshot | — |
| context-signals-mcp | 1.1.3 |
| cortex-agents | 5.0.1 |
| CultureDigitali/opencode-cron | — |
| denggui-ai/shy-cameo-skill | — |
| forcedotcom/salesforcedx-vscode | — |
| garikipatisai-code/sdlc-lean | — |
| gazacode | 2.0.2 |
| gitnexus-opencode | 0.5.3 |
| goatcode-sh | 0.1.9 |
| habithive-code | 0.3.1 |
| harness-mdocs | 2.2.0 |
| hc-teleport-agent | 0.3.0 |
| hivemind-3.0 | 0.1.0 |
| iamironz/opencode-sessions-explorer | — |
| ilahomesick/opencode-true-mem-v2 | — |
| jira-cli-agent | 0.2.0 |
| jn-s3s/opencode-tui-quota-usage | — |
| joe-broadhead/opencode-ashby | — |
| Khip01/opencode-rich-presence | — |
| lazyopencode-core | 0.0.4 |
| magpie-agy-acp | 0.1.12 |
| magpie-wakatime | 0.2.0 |
| memory-bank-skill | 7.4.3 |
| mike-zentarisystems/zentari-mac-dev-workstation | — |
| mpsuesser/effect-oxlint | — |
| novel-writer-english | 1.5.1 |
| oc-nonstop-router | 1.0.1 |
| oc-ping | 0.0.3 |
| oh-my-groundcontrol | 0.0.1 |
| oh-my-research | 0.1.0 |
| omctest | 0.0.3 |
| omo-stable | 3.6.0 |
| omo-suites | 1.17.0 |
| op-anthropic-auth | 0.1.4 |
| open-autopm | 3.6.11 |
| open-diff | 0.1.8 |
| open-loom | 0.1.10 |
| opencode-1m-context | 0.1.12 |
| opencode-agentic-engine | 0.5.12 |
| opencode-agentrouter-auth1 | 0.2.0-dev.2 |
| opencode-antigravity-auth-updated | 1.7.0 |
| opencode-anyrouter-auth | 0.1.0 |
| opencode-arise | 0.1.6 |
| opencode-asyntai | 1.0.0 |
| opencode-autopm | 3.7.0 |
| opencode-autoship | 2.21.1 |
| opencode-autoskills | 1.2.0 |
| opencode-blindfold | 0.5.1 |
| opencode-bubble-tabs | 0.4.0 |
| opencode-business-flow-reviewer | 2.0.0 |
| opencode-cloudflare-image | 2.0.0 |
| opencode-cn | 1.2.27 |
| opencode-code-archaeology | 2.16.11 |
| opencode-codebuddy-external-auth | 1.0.28 |
| opencode-copilot-1m | 1.10.0 |
| opencode-datalens-harness | 0.1.0 |
| opencode-discord-rpc | 1.0.1 |
| opencode-event-debug | 1.0.0 |
| opencode-focus | 0.1.3 |
| opencode-gemini-proxy | 1.1.0 |
| opencode-gitbutler | 0.1.11 |
| opencode-gliner-prune | 0.1.5 |
| opencode-godot-toolkit | 1.1.0 |
| opencode-island | 0.9.0 |
| opencode-keep-going | 1.1.1 |
| opencode-kickbacks | 0.1.1 |
| opencode-langgraph | 0.13.3 |
| opencode-lark | 0.2.2 |
| opencode-links | 0.1.1 |
| opencode-lookout | 0.1.3 |
| opencode-mad | 1.1.0 |
| opencode-mailbox | 0.0.13 |
| opencode-memfs | 0.0.12 |
| opencode-memory-pro | 1.6.2 |
| opencode-mimikkai-connect | 1.0.3 |
| opencode-model-routers | 0.2.11 |
| opencode-multisession | 0.3.0 |
| opencode-novel-plugin | 1.1.1 |
| opencode-novel-tools | 0.1.0 |
| opencode-ntfy-with-questions | 0.2.1 |
| opencode-obsidian | 1.1.3 |
| opencode-oci-oidc | 1.1.28 |
| opencode-omni-memory-plugin | 2.0.1 |
| opencode-openrouter-auth-broker-plugin | 0.2.2 |
| opencode-paste-as-file | 0.1.1 |
| opencode-permission-notify | 0.1.1 |
| opencode-plugin-ast-lsp | 0.0.6 |
| opencode-plugin-gitea | 0.3.3 |
| opencode-plugin-hub | 0.6.7 |
| opencode-plugin-inspector | 0.0.7 |
| opencode-powerpack | 2.0.0 |
| opencode-pr-link | 0.3.1 |
| opencode-promemory-4861 | 0.6.10 |
| opencode-prompt-rail | 0.1.9 |
| opencode-prompt-recorder | 1.9.9 |
| opencode-provider-litellm | 1.0.1 |
| opencode-quick-links | 1.3.1 |
| opencode-qwen-auth-plugin | 0.1.4 |
| opencode-raven | 2.4.1 |
| opencode-rive-sidebar | 0.1.0 |
| opencode-sdlc-plugin | 1.1.4 |
| opencode-session-media | 0.2.1 |
| opencode-shell-safety | 0.7.0 |
| opencode-shell-tasks | 0.1.1 |
| opencode-shingan | 1.3.0 |
| opencode-side-panel-sessions | 0.2.0 |
| opencode-slim-mcp | 1.0.0 |
| opencode-switchback | 2026.11.6 |
| opencode-talk | 0.1.1 |
| opencode-taskflow | 1.0.0 |
| opencode-telegram-bot | 1.1.2 |
| opencode-tianji | 0.6.0 |
| opencode-token-spend-bar | 1.0.3 |
| opencode-triton-ascend-generator | 0.1.0 |
| opencode-tui-utils | 1.3.0 |
| opencode-tuicr-plugin | 0.1.1 |
| opencode-turn-stats | 1.0.0 |
| opencode-ultra | 0.9.9 |
| opencode-usage-plugin | 0.0.2 |
| opencode-v2-tui-closetab | 0.1.0 |
| opencode-vcc | 0.1.0-alpha.1 |
| opencode-vibeplan | 0.2.0 |
| opencode-web-plugin | 0.1.1 |
| opencode-websearch-cited-fork | 2.0.4 |
| opencode-work-context | 0.11.2 |
| opencode-worklog | 0.0.2 |
| opencode-wrap | 0.3.0 |
| opencode-xai-oauth | 1.2.0 |
| opencode-zh-desktop | 0.2.2 |
| opencode-zh-plugin | 0.1.7 |
| opencode2-shell-tasks | 0.1.1 |
| opencode2-tps2 | 0.1.0 |
| opencode2-vision-relay | 0.2.2 |
| opencommand-plugin | 0.0.29 |
| opencub | 0.1.0 |
| opendevbrowser | 0.0.40 |
| openengineer | 0.3.1 |
| openeuler-agent-shennong-crash-online | 0.10.4 |
| openpaul | 1.0.0 |
| openrouter-genimage-kote-opencode | 0.1.0 |
| Ownistic/opencode-subagent-control | — |
| pasei-dev/opencode-profile-switcher | — |
| phlight | 0.2.15 |
| pixincreate/opencode-global-sessions | — |
| po-po-code | 0.9.6 |
| project-knowledge | 4.6.1 |
| rhmcp | 1.1.1 |
| rjstone/opencode-plugin-template | — |
| SaberOnGo/public-domain-books-translation | — |
| seniormode | 0.1.1 |
| silopolis/opencode-readonly-guard | — |
| sisyphus-debatewiki | 1.0.3 |
| skill-author | 1.1.0 |
| skillsmp-mcp | 1.0.4 |
| slipway-agents | 0.17.0 |
| Snakeblack/ospec-workflow | — |
| solidity-argus | 0.7.0 |
| solomemory-ai/opencode-solomemory | — |
| specifica-br | 1.12.2 |
| status-provider | 0.3.1 |
| tobias-weiss-ai-xr/opencode-saia-plugin | — |
| Verbiflow/mako | — |
| YonCZ/OpenCode-Presence | — |

> 数据源：catalog 分支 index.json + ai-verdicts.jsonl（governing concern 判词 reason 以 装测失败 开头的目标；另含 ai:pass + verify:failed 目标）。
> 对应历史 issue：closed issues label:concern:verify / label:ai:pass → https://github.com/awesome-market/awesome-opencode-market/issues?q=is%3Aissue+label%3Aconcern%3Averify
