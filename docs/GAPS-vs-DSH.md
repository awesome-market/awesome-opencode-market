# opencode-market vs dsh-market 功能对比与缺口（实测版）

> 2026-11-02 · dsh-market @ latest HEAD · 本项目 = `/Volumes/2t/code/opencode-market`
> ⚠️ 第一版错误已修：dsh `IMPROVEMENT-PLAN.md` 是**待办清单**不是功能清单——以下只列**代码实证存在**的能力。

## 本项目独有（dsh-market 代码里没有的）

| 能力 | 实证 |
|---|---|
| **静态安全扫描** | 8 条 tarball 规则（凭据/生命周期脚本/eval/外发 IP），redFlag+findings 进目录元数据。dsh `src/` 无 scan/security 模块，registry 是纯策展快照 |
| **目录级预验证** | 366/366 隔离 env 真装真加载（serve+API 触发懒加载+`loading plugin` canary）。dsh 只有**装后**校验思路，目录发布前不验证 |
| **权限隔离执行** | verify 分片 `permissions:{}` 跑不可信包、merge 单点写权 |
| **投稿自动化** | issue→扫描+证据评论→verdict→自动 label/close。dsh 投稿是 registry PR 人工审 |
| **冷启动 discovery** | npm keyword+GitHub topic+awesome README→star 三路自动入库。dsh registry 是手工 curated snapshot |

## dsh-market 实证有、我们没有的缺口

| # | 缺口 | 实证位置 | 优先级 |
|---|---|---|---|
| 1 | **收藏/分组/备注本地状态** | README：收藏书签+具名分组（批量开关）+自定义备注，写 profile `state.json`。我们 366 条目录无组织手段 | **P0** |
| 2 | **安装进度+取消** | `/dsh-market/status` 轮询 ndjson 进度 + 取消按钮（plan 里标"已有"）。我们 add 按钮干转圈 | **P0** |
| 3 | **错误日志导出（脱敏）** | `/dsh-market/logs` 导出 + `log-redaction.ts`。我们装失败只按钮变红 | **P0** |
| 4 | **主题体系** | 一键装+热切换+一组一主题。opencode 主题机制未验 | P1 |
| 5 | **更新路由** | `/dsh-market/update` re-add `name@latest`。我们装了没法更新 | P1 |
| 6 | **目录 TTL 缓存+快照回退** | `registry.ts` 1h TTL + snapshot 兜底+新鲜度。我们每次全量 fetch | P1 |
| 7 | **i18n（en+zh）** | `site/locales.mjs`。我们纯英文技术串 | P1 |
| 8 | **npm CDN 分发** | index.json 挂 npm+jsdelivr（15s 源时限优化）。我们只 Pages | P2 |
| 9 | **注册表格式校验** | `scripts/validate-registry.mjs` 独立 schema gate | P2 |
| 10 | **e2e 宿主冒烟** | `restart-smoke`/`install-e2e-host`/`check-web-auth-capture` 脚本。我们宿主侧只手动验 | P2 |
| 11 | **评论/隐私页/健康检查** | `comments.mjs`、privacy 双语、`check-site-health.mjs` | P3 |
| 12 | **热挂载** | `src/hot.ts` hotMount 装完即生效不重启。opencode `plugin add` 后 server 插件需服务重启 | P1（宿主机制差异，查 opencode 是否有等价物） |

## 双方都没有（dsh 官方自己的 PLAN 里认账的缺口）

这些是 dsh `IMPROVEMENT-PLAN.md` 自列的**待补**项，我们也缺——**不重复造轮子，可直接参考它的设计**：

- **装后生效确认**（dsh P0-2：读 `bundles` 验证真生效+列出没生效的原因）——我们装完只显示 installed，连"要不要重启"都不说
- **更新版本对比+假更新识别**（dsh P0-3：before/after 版本、minimumReleaseAge 导致的假更新）——我们没更新链自然也谈不上
- **构建脚本放行 UI**（dsh P0-4：allowBuilds 一键批准+重试）——pnpm/preinstall 拦截撞上没有出路
- **monorepo subpath/安装目标预检**（dsh P0-1：装之前先验证这个包真的含插件入口）——我们 `plugin add` 成功≠能用
- **stderr 关键行解析**（dsh P1-5：错误码/关键行而不是 600 字符一坨）——我们日志原样甩

## 产品哲学差距

dsh `AGENTS.md` 是产品规约（自然/好理解/普通用户三原则+验收清单+真实犯过的错）。本项目 UI 文案是纯技术串，`verified/skipped/redFlags` 没人话翻译，报错没有"发生了啥→为啥→咋办"三件套。**本项目应有自己的 AGENTS.md**（可直接借用它的框架）。

## 结论

- **安全纵深**：我们 > dsh（自动扫描+隔离执行+预验证，他们没有）
- **用户侧体验**：dsh >> 我们（本地状态/进度/更新/i18n/主题全套）
- **共同短板**：装后生效确认、假更新、build 放行、安装目标预检——两家都没做，是插件市场普遍痛点的**真空区**，谁先做谁赢
- **先补顺序**：P0 三件（本地状态、进度+取消、错误导出）是"用着爽"的地板；然后是"装后生效确认"这个两家共同缺口——和我们 verify 哲学一脉相承
