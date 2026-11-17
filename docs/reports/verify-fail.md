# 装测失败日报 — 2026-11-17

> 机械装测测量结果，**不是安全判定**：verify 管线实测"装不上/加载失败"的条目。
> 这些条目不再逐条开 issue——翻案靠重测转 verified 或人工 verdict；条目离开本表即翻案成功。

## 汇总
- 当前装测失败条目：**593**
- 按阶段：**load** 489 · **install** 82 · **structure** 13 · **render** 7 · **interactive** 2

## 明细
| 包 | 版本 | 阶段 | 原因摘要 |
|---|---|---|---|
| @arrislink/axon | 2.0.0 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: @arrislink/axon@2.0.0 |
| @chikage0o0/opencode-dcp | 3.1.14 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @chikage0o0/opencode-dcp@3.1.14: unable to resolve dependency tree |
| @cogbox/opencode | 0.190.5 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @cogbox/opencode@0.190.5: No matching version found for @cogbox/sdk@^0.163.0. |
| @elixcode/elixcode-bun | 0.9.4 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: @elixcode/elixcode-bun@0.9.4 |
| @kykiles/opencode-mem | 13.10.5 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: @kykiles/opencode-mem@13.10.5 |
| @opensploit/core | 0.2.0 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @opensploit/core@0.2.0: unable to resolve dependency tree |
| @sanoma-ai/connector-opencode | 0.11.24 | install | [sandboxed egress is allow-listed — an install fetch failure can be network policy, not a broken package] |
| @sergemso/opencode-plugin | 1.0.0 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @sergemso/opencode-plugin@1.0.0: unable to resolve dependency tree |
| @toolu/core | 7.11.0 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: @toolu/core@7.11.0 |
| @vibecontrols/vibe-plugin-ai-opencode | 2026.1115.1 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @vibecontrols/vibe-plugin-ai-opencode@2026.1115.1: unable to resolve dependency tree |
| @wentaoyuan/opencode-worktree | 0.5.2 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: @wentaoyuan/opencode-worktree@0.5.2 |
| @xiaowei1906/opencode-beep | 0.1.0 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @xiaowei1906/opencode-beep@0.1.0: Unsupported platform |
| 0then0/agentkcal | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install 0the |
| agiledon/openmole | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install agil |
| Akshat-2011/vibe-wise-opencode | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: Akshat-2011/vibe-wise-opencode#07154ac85cd7fad1f88ccdfb3d06ad04a45f22e0 |
| Alaye-Dong/opencode-hud | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Alay |
| aleks-spv/opencode_retrypush | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install alek |
| alexandru/opencode-session-todo | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install alex |
| AlexisBalayre/agentspine | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Alex |
| alfar1zi/design-extractor | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: alfar1zi/design-extractor#f77d76a9296ee493d8c6247a80ce16ccd2c04450 |
| AltimateAI/altimate-code | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Alti |
| amadeus-ex-machina/christina | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: amadeus-ex-machina/christina#d6320bbb9d189c12814b3a83dc26cb74dfc8adf0 |
| ambystechcom/AmbyKit | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install amby |
| AmethystLuna/embedded-workbench | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Amet |
| anandpant/opencode-palantir | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: anandpant/opencode-palantir#a8ffe2b9e8aac3b5380d3db3eec34ad3414f1f47 |
| anargia-pixels/opencode-automode-plugin | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install anar |
| AnotiaWang/opencode-web-plugin | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Anot |
| Ar5en1c/localqa | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: Ar5en1c/localqa#fe4891f61c8c16b9dc69e223bfa2d3228655933a |
| ArchAIHarness/agent-workflows | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install ArchAIHarness/agent-workflows#d9cef47f196410f6769a865924c0b469b4eea1b0: An unknown git err |
| ariga39/opencode-vision | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install arig |
| ATLAS-DEV78423/AgentBridge | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install ATLA |
| atman-33/multi-agent-ff15 | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: atman-33/multi-agent-ff15#1d30afc6c5dfbf0734cba4f3b3a9b9de56909fa6 |
| avinash-1707/Myrios | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install avin |
| aydemir/opencode-plugins | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install ayde |
| ayushnandi718-dev/opencode-chat | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install ayus |
| B-A-M-N/opencode-xgoal | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install B-A- |
| balatD/gorc | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bala |
| bastian-seifert/armin | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install bastian-seifert/armin#ecb3b61fb3124ea238fd0e6d8558a18a528eecbf: Could not read package.jso |
| batuhansk/opencode-talk | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install batu |
| bbingz/polycli | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bbin |
| benjaminshafii/digital-empire | — | install | [sandboxed egress is allow-listed — an install fetch failure can be network policy, not a broken package] |
| BernardYan2357/opencode-image-vision | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Bern |
| betterspec/opencode-betterspec | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bett |
| beydemirfurkan/opencode-gladio | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install beyd |
| BITRATE-Labs/vrchat-mcp | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install BITR |
| BlakeHastings/opencode-litellm | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Blak |
| Bouska/opencode-dcg-plugin | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Bous |
| br4zz4/opencode-smart-session-picker | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install br4z |
| bskim/opencode-azure-entra-auth | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bski |
| btca-server | 2.0.5 | install | [sandboxed egress is allow-listed — an install fetch failure can be network policy, not a broken package] |
| buddy-hq/buddy | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install buddy-hq/buddy#88e972bb13d33d10dfad7bec0d81cb465ef3c4bc: git dep preparation failed |
| buffsystems/buff-code | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install buffsystems/buff-code#efe79f86186cccf4b9f50d33da8aeebe3a9c10c4: git dep preparation failed |
| bulga138/peso | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bulg |
| devshaydez/seira | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install devs |
| fro-bot/space-bus | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install fro- |
| gonzalezpazmonica/savia | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install gonzalezpazmonica/savia#785124d8df81dfe38ffa3da35f00d9a521005498: undefined is not an obje |
| gotenksIN/opencode-websearch-addons | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install gote |
| H-Canopy/aether-moments | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: H-Canopy/aether-moments#2e069231fc526153ca42df93feee08cbf7cbbc3c |
| joe-broadhead/opencode-boxd | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| mcp-harmonyos | 1.1.0 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: mcp-harmonyos@1.1.0 |
| n8n-nodes-opencode-ai | 0.1.10 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: n8n-nodes-opencode-ai@0.1.10 |
| open-controller | 2.0.2 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install open-controller@2.0.2: Unsupported platform |
| opencode-bypass-agent | 1.0.0 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: opencode-bypass-agent@1.0.0 |
| oxdingzg/miao | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install oxdi |
| pythongiant/laya-drift | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: pythongiant/laya-drift#89ae9b28b60a47602247c785377512d8ca121a26 |
| Realmagnum/opencode-session-timestamps | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Real |
| rsshub | 1.0.0-master.1c6f945 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install rsshub@1.0.0-master.1c6f945: An unknown git error occurred |
| rynfar/meridian | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install rynf |
| sblattj/agentic-coding-harness | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install sbla |
| ShaoRoy/site-selection-skill | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: ShaoRoy/site-selection-skill#5195ce8d052417bee11e7636fa87c8ec096d48c5 |
| Sn0wo2/oc-keep-going | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Sn0w |
| Snakeblack/ospec-workflow | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Snak |
| stefanhoelzl/codehydra | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install stef |
| terry2010/opencode-loop-recover | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install terr |
| texugo7badger/OLYMPUS | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install texu |
| thejohnd0e/opencode-answer-date | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install thej |
| Thomashighbaugh/buchbinder | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Thom |
| Verbiflow/mako | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install Verbiflow/mako#3f1a676a713d25ce0d5ad73409252f96791b30e7: git dep preparation failed |
| YahyaHammad/Venastine-Research-Harness | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: YahyaHammad/Venastine-Research-Harness#fb82253ea5933dfa43f505c6974bb3bb65efe862 |
| YonCZ/rich-opencode | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install YonC |
| yurgeno/saut | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: yurgeno/saut#a456c9620151fdb7dfceb5034790cf3f539cba73 |
| ZaxbyHub/opencode-swarm | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Zaxb |
| mii9000/opencode-auto-switch | — | interactive | 交互式启动检查未通过——TUI 阶段异常退出 — plugin half passed (interactive); skill payload failed: |
| yriveiro/spectre | — | interactive | tre-1670b900538a7c4b9c587aa4d8e4713f661929ec/skills/definitions/pr-canvas/SKILL.md, spectre-1670b900538a7c4b9c587aa4d8e4713f661929ec/skills/definitions/principl |
| @0xsero/open-queue | 1.0.11 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @5dive/opencode-chat | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @5x-ai/5x-cli | 1.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @a4hgehad/weave-mcp | 0.10.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @accelerate-data/promptfoo-eval-harness | 1.9.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @accomplish_ai/agent-core | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Failed to load native module: pty.node, checked: build/Release, buil |
| @adhd/sox-host-registry | 0.7.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @aexol/pi-wizard | 0.6.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @agent-a/cli | 0.1.17 | load | --- stream tail --- timestamp=2026-11-16T08:06:23.588Z level=INFO run=0764b633 message="cli starting" version=2.3.0 channel=latest local=false args="[\"plugin\" |
| @agent-context/opencode-sift | 0.0.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @agentplugins/adapter-opencode | 0.6.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @aipno/opencode-token-monitor | 1.0.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @amends-dev/codemode-opencode | 0.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @anis00723/opencode-debug | 1.6.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @anthonyfangqing/opencode-special-edition | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @aquaticcalf/opencode-telegram | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @arandajulian/opencode-claude-mem | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @arcevico/opencode-agent-pulse | 0.2.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @aria-mcps/aria-mcp-gateway | 0.1.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @ariane-emory/must-have-plugin | 1.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @aryaminus/controlkeel-opencode | 0.4.21 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @asmadsen/opencode-node-package-manager | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @atlascloudai/opencode | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @austinthesing/magic-shell | 1.2.2 | load | --- stream tail --- --port\",\"0\"]" role=cli timestamp=2026-11-16T08:51:59.320Z level=INFO run=debfb775 message="database schema bootstrap started" migrations= |
| @bdliyq/opencode-rate-limit-retry | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @bengabay94/mrzero | 0.1.0-alpha.1 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown command 'serve' |
| @benjamolina/opencode-antigravity-guard | 1.1.24 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @betterspec/opencode | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@opencode-ai/plugin' imported from /tm |
| @bloodf/opencode-claude-mem | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @bluelovers/opencode-arise | 0.1.40 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @bogyie/opencode-kiro-plugin | 0.3.24 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @br4zz4/opencode-smart-tools | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: undefined is not an object (evaluating 'context.keymap.layer'))] |
| @bwanamaker/brandobot | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @bytesbrains/opencode-cruise | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @carson2222/fusion | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@opencode-ai/plugin' imported from /tm |
| @cat4869/token-lean | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @chethann/opencode-workflow | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @chriscode/devmux | 1.10.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @codemcp/workflows-opencode | 6.24.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @corti/cli | 1.6.3 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown command 'serve' |
| @cosmosdeng/nodeflow-mcp | 0.4.0-next.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @cravenceiling/opencode-etf | 1.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @crazy-goat/nexos-provider | 1.16.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @crixue/opencode-voice-stt | 0.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — serve reports the plugin failed to load |
| @ctbrk/ctbk-opencode-notifier | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @ctliz/pi-intercom | 0.14.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @cyan_tachyon/inf-copilot | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @d-ai/magpie | 0.1.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @danieldeusing/seedr | 0.1.186 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @deep-assistant/agent | 0.0.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @dendaio/opencode-9router-plugin | 1.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @devcxl/opencode-thinking-translater | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @deveco-test/deveco-harness | 0.2.0-test.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @dmmop/opencode-key-rotator | 2.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: Schema.isStartsWith is not a function. (In 'Schema.isStartsWith( |
| @doyzheng/ezllm-codebuddy-ide-auth | 0.3.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @dragonwize/opencode-event-shell-exec | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @dudousxd/nestjs-agent-opencode | 2.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @duoyun/opencode-notification | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @edo1994/opencode-queue | 0.13.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Cannot load \"effect/dist/unstable/http/index.js\" from plugin node_ |
| @elelem/opencat | 1.0.7 | load | ❌ Error: Missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN. |
| @ereinha/opencode-enhanced-quotas | 1.3.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @f97/opencode-morph-fast-apply | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fox-js/pad-skills | 4.0.1-0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fox-js/pc-skills | 4.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fpytloun/opencode-mnemory | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fractary/opencode-codex | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fractary/opencode-core | 1.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fractary/opencode-faber | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fractary/opencode-faber-cloud | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fractary/opencode-faber-code | 0.6.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @franzmoca/opencode-lombok | 0.1.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fulcrum-agent-os/opencode-plugin | 0.0.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gfn-cis/opencode-temp-sanitize | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: EACCES: permission denied, mkdir '/tmp/opencode/home-adce5cbc')]) |
| @ghilteras/opencode-model-fallback | 0.4.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gitawego/opencode-vision | 0.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gitterm/bot | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gitterm/discord-bot | 0.3.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gitterm/slack-bot | 0.3.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gramatr/opencode-plugin | 0.33.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @grandmaster451/kilo-superpowers | 2026.317.816 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @groundtrack/opencode-plugin | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @guan612/opencode-ai-light | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @hacr/opencode-autobe | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @happycastle/opencode-graphiti | 0.6.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @happycastle/opencode-openmemory | 0.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @hellofriday430/opencode-minimax-bridge | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@opencode-ai/plugin' imported from /tm |
| @heretek-ai/godot-testkit | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @hmos-library-adapter/flutter | 0.1.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @hmos-library-adapter/rn | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @hmos-library-adapter/sdk | 0.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @hotmanxp/opencode-qwen-login-plugin | 1.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @howaboua/opencode-planning-toolkit | 0.0.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @humaiz/opencode-cmdsync | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @humaiz/shot-drop-opencode | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @iam-brain/opencode-codex-auth | 1.10.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @iamtoricool/opencool-qwen-auth | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @inference/trace-opencode | 0.1.13 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @inferhub/helper | 0.2.9 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @intisy-ai/antigravity-auth | 1.17.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @intisy-ai/opencode-loader | 1.13.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @intisy-ai/opencode-proxy | 2.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @involvex/opencode-statusbar | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @isupervillain/opencode-container-exec | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jack-yang/opencode-bark-notify | 1.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jack-yang/opencode-tps-meter | 1.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: undefined is not an object (evaluating 'ctx.data.on'))]) |
| @jacob-z/opencode-token-usage | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jairodri/huckleberry-cli | 1.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jamesmurdza/opencode-daytona | 0.1.25 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jantcz/webai | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @javargasm/opencode-graphify | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @javargasm/opencode-kiro-auth | 8.3.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jentrix/plugin-opencode | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jianmu-plugins/page-agent-console | 1.3.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jianmu-plugins/page-chat | 0.1.14 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jianmu-plugins/tools-calc | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jimmyyen/opencode-context-cache | 1.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jimmyyen/opencode-registry-plugin | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jmylchreest/aide-plugin | 0.1.18 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @joe-broadhead/opencode-jobs | 0.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: HOST_UNTESTED: This plugin supports OpenCode >=2.2.3 <2.3.0, found 2 |
| @johannus22/opencode-tps-meter | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @justmpm/ai-tool | 6.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: Context.GenericTag is not a function. (In 'Context.GenericTag(\" |
| @k98kurz/opencode-fixtodo | 0.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @kagan-sh/kagan | 0.4.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @kevinfx/magpie-mcloud | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @kevinfx/magpie-wps-lingxi | 0.3.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @kiritoko1029/opencode-add-oai-instruction | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @knowl/opencode | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @kungfusaini/opencode-worklog | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @lansya/opencode-plugin-claude-memory | 1.0.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @leo.gimp/opencode-usage-bar | 3.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: ctx.storage.store is not a function. (In 'ctx.storage.store(\"se |
| @lightfish/react-opencode-ui | 0.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @loreai/opencode | 0.40.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @lucid-agents/opencode-x402-plugin | 0.1.12 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @lyculs/opencode-engram | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @lyculs/opencode-firecrawl | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @lyculs/opencode-startup-context | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(BuildMessage: Unexpected escape sequence)]) |
| @lynxlabs/oikonomos | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @lzy6755/ai-chat-opencode | 0.1.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(AggregateError: 12 errors building \"/tmp/verify-juHJqN/u/cache/opencode/np |
| @mac110/opencode-openai-compatible | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @macqueen1001/opencode-think-with-me | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mageyuki/opencode-subagent-statusline | 0.7.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — serve reports the plugin failed to load |
| @mailshieldai/opencode-canvas | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @marcelorodrigo/opencode-spring-crew | 0.3.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mazac-fox/opencode-conductor | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mazac-fox/opencode-fleet-contracts | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mcrescenzo/opencode-child | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mcrescenzo/opencode-goals | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mcrescenzo/opencode-sessions | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @melodyoftears/opencode-qwen-auth | 1.3.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mhsenam/opencode-token-saver | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @microsoft/agent-governance-opencode | 5.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mimirsynth/opencode | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mingeon/opencode-blueprint | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mingxy/cerebro | 2.3.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mingxy/ocosay | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mirsella/context7-account-broker | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @misaelcs/opencode-jev | 2.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mixio-pro/kalaasetu-plugin | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mixio-pro/mixiocode-plugin | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mjfuertesf/pi-quota-status | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mlflow/opencode | 0.5.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @molecule/api-agent-transcript-opencode | 1.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @monotykamary/pi-opencode-provider | 1.0.83 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @moozie/opencode-voice | 0.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @moritakaaz/opencode-apc | 1.2.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mscortana/toki | 2.22.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mtrojnar/pi-usage | 0.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mytai20100/opencode-browser | 0.0.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @n0c1ip/opencode-pohuy | 0.1.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @nahuelcio/opencode-ado | 0.4.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @nano-step/skill-manager | 5.30.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @neilurk12/pi-free-models | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @neomei/opencode-clawmessenger | 0.5.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @neomei/opencode-feishu | 0.6.9 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @neomei/opencode-qiwei | 0.3.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @nest4869/argos | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @netsirk/depot | 3.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(SyntaxError: Export named 'Either' not found in module 'effect'.)]) |
| @ninkch/opencode-mem | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @nk070281sjv/cli | 3.0.65 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown command 'serve' |
| @nodeint/migent-adapters | 0.8.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @npll/omol | 5.0.0-beta.6-omol.202608120621 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: ENOENT: no such file or directory, open '/tmp/verify-U7nFUG/u/cache/ |
| @obrigado/surface | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @octafy/helper | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @oh-harness/plugin | 0.2.0-test.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @old-mikser/occontext-thinking-trim | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openagentsy/footprint | 0.2.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openagentsy/hooks | 0.2.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openagentsy/ledger | 0.2.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openagentsy/memory | 0.2.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openagentsy/models | 0.2.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openagentsy/tasks | 0.2.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openclient-ios/opencode-plugin | 0.5.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Invalid OpenCode server port)]) |
| @opencode_weave/weave | 0.9.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-cockpit/daemon | 0.11.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-cockpit/protocol | 0.11.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-compat/adapter | 0.4.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-compat/cli | 0.4.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-compat/facade-plugin | 0.4.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-compat/facade-sdk | 0.4.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-compat/pi-bridge | 0.4.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-qq/plugin-sdk | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-trace/core | 0.0.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-trace/plugin | 0.0.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencomms/opencode-plugin | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencoop/opencode-plugin | 1.16.0 | load | --- stream tail --- lugin@1.16.0/1794816389200/node_modules/@opencoop/opencode-plugin/dist/index.js http.span=181 role=server timestamp=2026-11-16T08:06:40.338Z |
| @openhax/codex | 0.4.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openpets/fal | 1.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openpets/huggingface | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package 'openpets-sdk' imported from /tmp/verif |
| @openpets/telegram-bot | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find module './openapi-tools' imported from /tmp/ver |
| @openplugins/token-balance | 1.1.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Environment variable \"OPENTUI_FORCE_WCWIDTH\" is already registered |
| @openprojectx/opencode-kimi-auth | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opentj/opencode-oauth2-plugin | 1.0.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @otsupeko_lee/work-work | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @ousing9/omo-no-time | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @overbit/opencode-plugin-litellm | 0.7.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @oxel40/opencode-model-groups | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @oy-cli/opencode | 0.14.13 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: undefined is not an object (evaluating 'ctx.catalog.transform')) |
| @pantheon-ai/opencode-warcraft-notifications | 1.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @parallel-web/opencode-plugin | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @pawbxj/arena-cli | 1.0.0-Beta | load | --- stream tail --- timestamp=2026-11-16T09:37:56.121Z level=INFO run=a556afee message="cli starting" version=2.3.0 channel=latest local=false args="[\"plugin\" |
| @pemessage/opencode-worktree | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @pipellm/magpie-websearch | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @pkcpkc/opencode-plugin-command-hooks | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @pnz1990/open-krode | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @potb/opencode-plugin-noop | 0.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @principal-ade/agent-manager | 1.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @promethean-os/opencode-openai-codex-auth | 3.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @quarkos/pi-fusion | 1.0.12 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @r3nic1e/opencode-openai-decisions | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: openai-decisions: set options.endpoint to the Decisions URL, for exa |
| @r4coder/magpie-plugin | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @ratteeth1/opencode-session-manager | 0.1.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @razroo/opencode-model-fallback | 0.3.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @really-knows-ai/foundry | 3.15.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @redfoxxo/pounce | 1.1.0 | load | --- stream tail --- timestamp=2026-11-16T12:05:21.209Z level=INFO run=9cb436c5 message="cli starting" version=2.3.0 channel=latest local=false args="[\"plugin\" |
| @rejacky/opencode-insights | 1.0.1 | load | --- stream tail --- :06:10.391Z level=INFO run=3aeab3f8 message="watcher stopped" path=/tmp/verify-OYPdJg/u type=entries http.span=20510 role=server timestamp=2 |
| @renjfk/opencode-notify | 1.1.0 | load | --- stream tail --- :05:51.736Z level=INFO run=d809d0cd message="watcher stopped" path=/tmp/verify-JyMabg/u type=entries http.span=20517 role=server timestamp=2 |
| @renjfk/opencode-secret-tools | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Both listCmd and getCmd are required options)]) |
| @ririnto/amazon-bedrock-anthropic | 0.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @riskihajar/opencode-omniroute-auth | 1.3.29 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @robinmarin/opencode-teams | 0.1.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @rstacruz/opencode-autoask | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @s3tupw1zard/langfuse-opencode-observability-plugin | 0.1.0-dev.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(SyntaxError: Export named 'SeverityNumber' not found in module '/tmp/verify |
| @seed-lab/opencode-seed-agent | 0.1.22 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @sentiolabs/opencode-arc | 0.3.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @sentiolabs/opencode-slop-review | 0.5.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @seonggukchoi/opencode-notifier | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @sergemso/opencode-observability | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@opentui/solid' imported from /tmp/ver |
| @serii84/vertex-partner-provider | 1.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @sessionwise/opencode-plugin | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @shaogefenhao/overnight | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @sheiksadi/opencat | 0.0.5 | load | ❌ Error: Missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN. |
| @shgroup/opencode-serenity-plugin | 0.9.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @shodocan/opencode-hindsight | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @skastr0/background-tasks-opencode | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: Schema.nonNegative is not a function. (In 'Schema.nonNegative()' |
| @skastr0/groundwork-opencode-plugin | 0.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @snubisks/opencode-dcp | 3.1.14 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @sonic182/graphmem | 0.15.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @spmurrayzzz/opencode-openai-codex-auth | 3.3.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @spritz-finance/opencode | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @subadeepan_y/vi3ion-opencode | 0.1.4 | load | plugin half passed (load); skill payload failed: |
| @sublang/cligent | 0.39.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @suncreation/opencode-claude-patch | 0.3.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @super-pocock-ai/memory-core | 2.3.30 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @sureshsankaran/ralph-wiggum | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @talocode/skilllane | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @tder311/opencode-orchestrator | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @te-river/opencode-alibabatokenplan | 0.2.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Environment variable \"OPENTUI_FORCE_UNICODE\" is already registered |
| @tengxiaohtx/connect | 1.2.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @the3asic/opencode-smart-title | 0.2.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @thehugeman/opencode-anthropic-auth-community | 0.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @thesammykins/discord_opencode | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @thesammykins/tether | 1.7.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @tkwf/opencode-shellfix | 2.3.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @tokenmix/opencode-plugin | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @tokentop/agent-opencode | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @toninho09/opencode-wakeup | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @toolr/seedr | 0.1.80 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @typedecision/runtime-linux-x64-gnu | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: To load Node-API modules, use require() or process.dlopen instea |
| @until-dev/plugins | 0.2.9 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @varonell/ai-usage | 1.7.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find module 'electron'\nRequire stack:\n- /tmp/verif |
| @vaur94/figma-rust | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: Schema.isStartsWith is not a function. (In 'Schema.isStartsWith( |
| @veedubin/boomerang-v2 | 4.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: \nSomething went wrong installing the \"sharp\" module\n\nCannot fin |
| @veedubin/opencode-boomerang | 1.0.12 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @velum-labs/routekit-tool-opencode | 1.5.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Cannot load \"effect/dist/unstable/process/index.js\" from plugin no |
| @vheins/opencode-model-fallback | 0.1.18 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @vikrant82/opencode-context-truncate | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @vmifev/auto-init-config | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @voidrot/openai-featherless-compatible | 0.3.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @volcengine/tls-observer-opencode | 0.0.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @wafonro2/opencode-resurrect | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @wakeshift/opencode | 1.4.57 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @weiyentan/opencode-plugin-sqlite | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(SyntaxError: Export named 'Database' not found in module '/tmp/verify-8kJn0 |
| @whomwah/opencode-nelson-muntz | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @wix/pathgrade | 1.0.69 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @wolfx/oh-my-openagent | 4.19.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @wzzjjboy/opencode-wecom-notify-plugin | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @x1aoye/conflux-oc | 0.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @x1aoye/tao-tie-oc | 0.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @xpufx/agent-mux | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @yanu30adi/vision-bridge-mcp | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @yaoguai_xh/opencode-goal-plugin | 0.10.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @yourlocalai/your-local-ai | 0.1.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @yugimob/pi-opencode-go-rotation | 1.7.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @yyg27/manbun | 4.10.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @z3z1ma/open-loom-playbooks | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @zchazc/nbcb-provider | 1.0.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @zeklop/opencode-antigravity-auth | 1.6.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @zenmux/opencode-oauth | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @zhzy0077/opencode-terminal-title | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @zilliz/memsearch-opencode | 0.4.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: MemSearch CLI unavailable. Install with uv tool install 'memsearch[o |
| @ziuus/daily | 1.2.9 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @zwidny/opencode-mempalace | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| 00bx-kiro-gateway | 1.0.9 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| active-collab-agent | 0.12.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| agent-data/job-search | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| agent-memory-store | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| agent-sdk-kit | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@github/copilot-sdk' imported from /tm |
| agent-status-opencode | 0.1.33 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| agentic-remem | 0.2.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| agy-openai-bridge | 0.2.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| ailense | 0.1.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| aios-forge | 1.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| Ajwyunsx/opencode-commandcode-go | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| akm-opencode | 0.10.261130 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| alexmarco/opencode-skill-pulse | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| alkevintan/opencode-advisor | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| alkevintan/opencode-vision | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| alpha-agent-ai | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| amazingteam | 3.0.23 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| andyzasl/opencode-copilot | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: undefined is not an object (evaluating 'context.data.on'))]) |
| anis-dr/opencode-mermaid-renderer | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| Ansh-Sonkusare/jev-compaction-harnesses | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| antick/skills | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| antigravity-auth | 1.17.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| antri_cli | 1.57.52 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: cannot add command 'backend' as already have command 'cloud\|backend' |
| anytxt-opencode | 0.0.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| arch-governance-nfrega | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| arfoux/rs-guard-v1 | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| aryasaatvik/opencode-plugin-executor | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Cannot load \"effect/dist/unstable/http/index.js\" from plugin node_ |
| Asno-dev/apex | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| auto-model-switcher | 1.3.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| autoaidev | 1.0.312 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find module 'vscode'\nRequire stack:\n- /tmp/verify- |
| autosquid/omo-mem | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| avaritiachaos/qoder-proxy | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| awesome-agent-skills-mcp | 1.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bad-noodles/opencode-qwen-auth | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| Barathaner/paul-persistent-atlassian-undestanding-meeting-logger | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bc1xxx/orchestrator-opencode | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| benskls/openstrat | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| better-opencode-async-agents | 0.10.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| better-opencode-openai-codex-auth | 0.1.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bg-tasks-mcp | 0.8.0 | load | --- errors --- [bg-tasks] Error: unknown argument "serve" --- stream tail --- timestamp=2026-11-16T12:53:58.500Z level=INFO run=86f257f3 message="cli starting"  |
| bhumitschaudhry/Slopnought | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bitbucket-agent | 1.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bnc4vk/opencode-model-scorecard | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(SyntaxError: Export named 'jsxDEV' not found in module '/tmp/verify-iJYSA7/ |
| BowTiedSwan/opencode-video-gateway | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bsosik1/opencode-arcana | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| ca-x/magpie-intern-ai | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| cache-timer | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| claude-ai-switcher | 1.5.0 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown command 'serve' |
| clew-code | 0.11.0 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown option '--port' |
| cli-continues | 2.4.3 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown option '--port' |
| cliproxy-provider | 1.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| code-stroll | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| codemax-opencode-setup | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| codex-plugin-oc | 1.0.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| cortico-provider-opencode | 0.6.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package 'cortico' imported from /tmp/verify-W51 |
| cosa-opencode | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| database-admin | 1.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| deveco-model-plugin | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| dico-open | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| discourse-descent | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| dm-bot | 1.1.18 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — serve reports the plugin failed to load |
| dondon-notify | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| donice-evaluator | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| dyegolara/lnurl-auth-agents | — | load | --- stream tail --- -port\",\"0\"]" role=cli timestamp=2026-11-16T08:51:52.827Z level=INFO run=cc8f85ec message="database schema bootstrap started" migrations=5 |
| endvour | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| etchplan-opencode | 0.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| eve-ai | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| even-agent-home | 1.0.10 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| fernhop | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| fortunememory | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| gateclaw-telegram-bot | 0.15.0 | load | Failed to start bot: Missing required environment variable: TELEGRAM_BOT_TOKEN (expected in /tmp/verify-sVd8Gp/u/.env) |
| gitbot-ai | 0.0.3 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown command 'serve' |
| glootie-oc | 2.0.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| goodtome/magpie-teleagent-login | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| grok-search-skill | 1.3.9 | load | --- stream tail --- timestamp=2026-11-16T10:13:07.306Z level=INFO run=07450a1a message="cli starting" version=2.3.0 channel=latest local=false args="[\"plugin\" |
| gsd-opencode | 1.38.5 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — ✗ error: unknown command 'serve' |
| gyoshu | 0.4.33 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| halloweed-anthropic-auth | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| img-read | 1.1.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| inject-user-id | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| iron-horse-opencode | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| jarvis-hq | 0.0.7 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown command 'serve' |
| jinyue806/Agnes-Code | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| kei-mcp | 1.6.0 | load | Error: API key required. Use --api-key or set KEI_API_KEY environment variable. |
| kravchenski/switchyard | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| llisa | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| local-knowledge-graph | 1.14.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-amd-cloud | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-ducoro | 0.4.10 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-gemini-web | 0.15.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-kilo-auth | 0.5.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-mira-relay | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-model-quota | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-plugin-loomy-auth | 0.1.27 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| mem0-collector | 0.7.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| minoemem | 1.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| nimsuper | 0.3.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| oc-blackbytes | 0.8.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| oc-codex-multi-account | 1.0.20 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| officeace-auth | 0.3.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| oh-my-resume | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| omgvibe | 0.2.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| open-ralph-loop | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencarly | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-0-injection | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-adversary | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-agent-cpa-env-switcher-plugin | 0.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-agent-doctrine | 0.1.5 | load | error: unknown argument: --port |
| opencode-agents-local | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-agy | 0.15.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-aiway-auth | 1.0.22 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-annotate | 2.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — serve reports the plugin failed to load |
| opencode-anthropic-context-1m | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-anthropic-user-agent-plugin | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-antigravity-auth-remix | 1.5.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-api | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-api-node | 1.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-ascii | 0.1.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-ask-human | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-auto-continue | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-auto-shift | 0.5.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-bgtask | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-bonescript-backend | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-capture | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-capy | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-chorus | 0.10.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-claude-auth-custom | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-cloakpipe | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-content-filter | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-continual-learning | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-deepseek-chan | 1.0.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-delegations-sidebar | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-devcontainers | 0.5.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-discuss | 0.7.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@opencode/ai' imported from /tmp/verif |
| opencode-discussion-agent | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-durable-goal | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-env-protect | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-epf | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-feishu | 1.10.10 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-fleetview | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-fs-ops | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-gbuild | 0.13.1 | load | plugin half passed (load); skill payload failed: |
| opencode-gemini-cli-provider | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-gemini-subagent | 0.1.27 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: @opencode-ai/plugin not found. This plugin must be loaded from withi |
| opencode-gh-ci | 0.2.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-go-monitor | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-google-search | 0.1.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-harness | 7.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-im-bridge | 0.46.0 | load | at error (/tmp/verify-pyx92I/u/cache/opencode/npm/opencode-im-bridge@0.46.0/1794819141586/node_modules/zod/v3/types.js:39:31) |
| opencode-itsuki | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-kunrouter-auth | 0.8.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-langgraph | 0.13.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-litellm-plugin | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-local-provider | 0.1.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-mirasim-auth | 0.9.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-multi-llm | 0.1.9 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-muse | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(MuseInvalidConfigError: muse does not advertise --contributor-mode; refusin |
| opencode-oauth | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — serve reports the plugin failed to load |
| opencode-plugin-codex-usage | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(SyntaxError: Export named 'jsxDEV' not found in module '/tmp/verify-rXJuiA/ |
| opencode-plugin-question-force-close | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Environment variable \"OPENTUI_FORCE_WCWIDTH\" is already registered |
| opencode-proxy | 2.0.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-qoder-plugin | 0.2.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-shell-guard | 1.3.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-sound-hooks | 1.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-tab-status | 1.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-tui-image-clipboard-fix | 1.0.17 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-vision-paste | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode2api-proxy | 1.2.2 | load | 930 \| } catch (error) { |
| P-Core-System/pcore-orchestra | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| pi-cn-free-model-providers | 1.0.31 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@earendil-works/pi-coding-agent' impor |
| pi-opencode-go-provider | 1.1.59 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| scnet-magpie | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| skyer-now/carlos-flow | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| spotme | 1.2.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| suvadu-opencode-hook | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| swarm-code | 0.1.24 | load | --- stream tail --- timestamp=2026-11-16T13:20:49.174Z level=INFO run=ecf59573 message="cli starting" version=2.3.0 channel=latest local=false args="[\"plugin\" |
| yanamianna0501/antigravity-acp-auth | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @phux/opencode | 0.10.0 | render | gui setup: Cannot read properties of undefined (reading 'finally') |
| @rizal72/oc-git | 0.2.3 | render | gui setup: Unknown error (cause: Cannot read properties of undefined (reading 'catch')) |
| opencode-activity-indicator | 0.1.0 | render | gui whitelist: module not in gui host whitelist: electron |
| opencode-control-surfbird-for-kitesurf | 0.5.1 | render | gui whitelist: module not in gui host whitelist: node:fs/promises |
| opencode-loop-recover | 0.2.4 | render | gui whitelist: module not in gui host whitelist: node:fs/promises |
| opencode-navigator | 0.27.8 | render | gui whitelist: module not in gui host whitelist: node:crypto |
| opencode-voice-dictation | 0.14.0 | render | gui whitelist: module not in gui host whitelist: node:child_process |
| adriansoriacastellano/hitl-analytics-team | — | structure | 63f56866139f7c87ddf38b29b/.agents/skills/skill_build_marts_layer/SKILL.md, hitl-analytics-team-e529082c885d23863f56866139f7c87ddf38b29b/.agents/skills/skill_bui |
| agisota/old-one | — | structure | (无日志摘录) |
| and-rs/dotfiles | — | structure | (无日志摘录) |
| ashikonik/skills-library-mcp | — | structure | (无日志摘录) |
| bthavanish/demiurge | — | structure | no parseable SKILL.md frontmatter in bthavanish/demiurge#3bd448bb56d7cee99fbbf9eea35991446e3286fd (checked 12: demiurge-3bd448bb56d7cee99fbbf9eea35991446e3286fd |
| Burnsedia/Django-Agent | — | structure | no SKILL.md in Burnsedia/Django-Agent#368c4440d80910de6b819bf7fe21c2ff7f4afcc9 tarball |
| dilanrojas/dotfiles | — | structure | (无日志摘录) |
| madeinorbit/podium | — | structure | (无日志摘录) |
| motusakapeppo/opencode-skill-assemblea-complessa | — | structure | no parseable SKILL.md frontmatter in motusakapeppo/opencode-skill-assemblea-complessa#f28c42476f8fdfb6aa0746eb6ce8188c18a81cac (checked 1: opencode-skill-assemb |
| NeoMei/SuperWagie | — | structure | (无日志摘录) |
| Ricky06202/nixdots | — | structure | (无日志摘录) |
| schizo16/opencode-skillforge | — | structure | no parseable SKILL.md frontmatter in schizo16/opencode-skillforge#e1c09c427843a693b62bb0d8e1106952f15d2e10 (checked 3: opencode-skillforge-e1c09c427843a693b62bb |
| zhitongblog/unterm | — | structure | (无日志摘录) |

> 数据源：catalog 分支 index.json + ai-verdicts.jsonl（governing concern 判词 reason 以 装测失败 开头的目标）。
> 对应历史 issue：closed issues label:concern:verify → https://github.com/awesome-market/awesome-opencode-market/issues?q=is%3Aissue+label%3Aconcern%3Averify
