# opencode-market vs dsh-market 功能对比与缺口

> 2026-11-02 · dsh-market @ latest HEAD · 本项目 = `/Volumes/2t/code/opencode-market`
> dsh-market 是成熟产品（收藏/分组/主题/备注全套本地状态 + 热挂载 + 错误诊断链），本项目刚走完"收录→验证→安装"主链。差距按"用户感知价值"排序。

## 本项目独有的能力（dsh-market 没有）

| 能力 | 说明 |
|---|---|
| **静态安全扫描** | 8 条规则扫 tarball（凭据读取/生命周期脚本/eval/外发 IP……），redFlag + findings 分级，写进目录元数据——dsh-market 是纯策展注册表，无自动扫描 |
| **安装前真实验证** | 每包在隔离 XDG env 真装+真起 `serve`+curl API 触发懒加载，看 `loading plugin` 日志行；366/366 全量跑完（309 verified / 57 真 failed / 130 redFlag-skipped）——dsh-market 只有装后校验，没有目录级预验证 |
| **权限隔离执行** | verify 分片 `permissions:{}` 跑不可信代码、merge 单点有写权——dsh-market 无此分层 |
| **投稿自动化** | issue→静态扫描+证据报告→verdict→自动 label/close——dsh-market 投稿走人工审 registry PR |
| **冷启动 discovery** | npm keyword + GitHub topic + awesome README→star 过滤三路自动入库 |

## 缺口（dsh-market 有、我们没有）——按价值排序

| # | 缺口 | dsh-market 的做法 | 优先级 |
|---|---|---|---|
| 1 | **装后生效确认** | 装完读 `dsh.profile.bundles` 验证真生效，列出"装了但没生效的原因"（hot mount / 需重启 / build 脚本没放） | **P0**——我们现在装完只看到 "installed"，用户不知道要不要重启、装没装对 |
| 2 | **安装进度+取消** | ndjson 结构化进度事件 + 取消按钮 + 阶段提示 | **P0**——现在 add 按钮转圈直到出结果，慢包像死了 |
| 3 | **错误诊断链** | stderr 关键行解析 + 错误旁"导出日志"（脱敏） | **P0**——现在装失败只有按钮变红，没有原因 |
| 4 | **构建脚本放行** | `allowBuilds` 一键批准+重试（pnpm 安全机制） | **P0**——opencode `plugin add` 也会撞 preinstall 拦截，现在没有出路 |
| 5 | **收藏/分组/备注** | 三件本地状态都写 profile `state.json`，分组带批量开关 | **P1**——366 条目录逛起来的核心组织手段，我们没有 |
| 6 | **主题支持** | 一键装+热切换+一组最多一个主题 | P1（opencode 主题机制还没验过） |
| 7 | **更新链** | `name@latest` re-add + before/after 版本对比 + `minimumReleaseAge` 感知 | P1——现在装了就没法管更新 |
| 8 | **假更新识别** | 明确告诉用户"上游 npm 没发新版"而不是静默成功 | P1（同上） |
| 9 | **目录过期提示+手动刷新** | TTL 缓存+快照回退+页头"数据是 X 小时的" | P1——现在我们每次 fetch 不缓存，也无新鲜度标识 |
| 10 | **i18n（en+zh）** | `site/locales.mjs` 全量双语 | P2 |
| 11 | **npm CDN 分发目录** | index.json 挂 npm+jsdelivr，比 GitHub Pages 快且稳 | P2（我们现在只 Pages 单点） |
| 12 | **monorepo subpath 解析** | 安装目标校验"这个包真的含插件入口"再装 | P2——我们 `plugin add` 成功≠插件可用，还没做入口预检 |
| 13 | **注册表格式校验** | `validate-registry.mjs` schema gate | P2（我们有 zod schema 但无独立 validate 脚本） |
| 14 | **e2e 宿主冒烟** | restart-smoke / install-e2e-host / check-web-auth-capture | P2——我们宿主侧只有手动真机验 |
| 15 | **隐私页/健康检查** | privacy.en/zh + check-site-health | P3 |
| 16 | **卸载/启用开关** | 分组开关+单插件 toggle | P3（opencode 插件管理机制待查） |

## 产品哲学差距（AGENTS.md 那套）

dsh-market 的 AGENTS.md 是本项目的**产品规约**——"自然/好理解/面向普通用户"三原则 + 八条验收清单 + 真实犯过的错清单。我们当前市场 UI 的文案是纯技术串（`verified`/`skipped`/`redFlags`），没有翻译成人话、没有"所以呢→怎么办"的报错三件套、没有渐进披露（findings 默认展开）。**本项目没有自己的 AGENTS.md 产品约束**——照抄它那条框架是对的。

## 结论

- **安全验证链**：我们 > dsh-market（自动扫描+隔离执行+预验证是他们没有的深度）
- **用户侧体验链**：dsh-market >> 我们（装后确认/进度/错误/收藏分组这些"用着爽"的东西我们基本没做）
- **最值得先补的**：P0 四项（装后生效确认、进度、错误诊断、build 放行）——都是"装"这个核心动作的确定性保障，和我们 verify 管线的哲学一脉相承
