# 迁移计划:spike → awesome-market

本文档跟踪从 `terry2010/opencode-market-spike` 迁移到 `awesome-market`
GitHub 组织的过程,生产(prod)与开发(dev)环境分离。

## 仓库分工

```text
awesome-market/
├── awesome-opencode-market   # 产品本体:源码、流水线、站点、项目文档(prod)
├── awesome-opencode-plugin   # 生成的插件收录列表 README(计划中)
└── awesome-opencode-skill    # 生成的技能收录列表 README(计划中)

terry2010/awesome-opencode-market  # fork,用于开发和 workflow 测试(dev)
```

- **主仓库:**讲清 Market 是做什么的、怎么安装、校验结果如何帮助用户挑选。
  可以偶尔放少量精选扩展;不要把全量目录搬进这个 README。
- **plugin/skill 仓库(后续阶段再建):**开头注明投稿渠道和链接(指向主仓);
  按分类展示条目,附简介和源链接。它们是展示/发现面。
- **数据本体:**`index.json`、`ai-verdicts.jsonl` 及相关审计数据在主仓
  `catalog` 分支;站点由该分支构建。索引仓在 catalog 发布成功后从这些
  数据生成 README。
- **索引仓 README 格式(已定):**顶部说明 + 全量分类列表。列表太长是已知
  风险,出现后再迭代(例如浓缩列表 + 链向完整网页目录)。

## 当前状态

| 项 | 状态 |
|---|---|
| GitHub 组织 `awesome-market` | 已创建 |
| npm 组织 `awesome-market` | 已创建 |
| npm 包 `awesome-opencode-market` | 已发 `0.0.1` 占位;挂在 npm 组织下 |
| 开发包 `oc-market-quail-zephyr-72a0` | 保留 `0.0.3` |
| GitHub 新仓 | 尚未创建 |
| spike 仓库 | 保留不归档;迁移前停掉其 Actions |
| spike 历史清理 | `main`/`catalog` 已重写移除 `docs/RESEARCH.md`;`broken-fixture` 本就不含该路径 |
| 本地 origin | 仍指向 spike |
| 待提交文件 | `README.md`、`README.zh.md`、`LICENSE`、`docs/MIGRATION.md`、`docs/market-panel.png` 均未跟踪 |

npm 包是无 scope 的裸名,安装名和页面地址保持
`awesome-opencode-market` / `npmjs.com/package/awesome-opencode-market`。
npm 页面上某个版本的发布者显示的是执行发布的账号,不代表包是否挂在
组织名下。

## 迁移序列

### 1. 停掉 spike 的自动化

- 迁移开始前先禁用 `terry2010/opencode-market-spike` 的 Actions,停止定时
  和手动触发的任务:

  ```bash
  gh api -X PUT repos/terry2010/opencode-market-spike/actions/permissions -f enabled=false
  ```

- 仓库本体和 Pages 端点留在原地。**不归档**,也不加废弃横幅。
- 旧 Pages 内容会作为过期快照继续可用。在新生产端点部署并验证完成前,
  客户端继续指向旧地址。

### 2. 本地仓库预检

- Git push 不会带未跟踪文件——先决定并提交要迁移的文件(见当前状态表)。
- `main` 和 `catalog` 为必选分支;`catalog` 含现有目录与审计数据,历史
  必须保留——catalog workflow 有 fail-closed 保护(catalog 分支存在但
  `index.json` 为空时拒绝运行),保留数据分支正好满足它。
- `broken-fixture` 一并迁移(见已定决策)。
- 当前仓库没有 tag。
- 推送前确认工作区与选定历史内容。

### 3. 安全建生产仓

1. 建空公开仓(不初始化 README、license、`.gitignore`):

   ```bash
   gh repo create awesome-market/awesome-opencode-market --public
   ```

2. **首次 push 前先禁用 Actions。**当前 `ci.yml` 在 push 到 `main` 时就
   会触发,push 完再关已经来不及:

   ```bash
   gh api -X PUT repos/awesome-market/awesome-opencode-market/actions/permissions -f enabled=false
   ```

3. 只推预检选定的分支,用显式 ref:

   ```bash
   git push <prod-remote> main catalog broken-fixture
   ```

   不用 `git push --mirror`:它会复制所有 ref 命名空间(包括
   remote-tracking ref),还可能删除目标仓的 ref。

4. 在 GitHub 上核对 `main` 与 `catalog` 分支内容。此时仍不开启生产
   自动化。

### 4. 建开发 fork

- 把 `awesome-market/awesome-opencode-market` fork 到 `terry2010`。
- 新 fork 的 Actions 默认受限;审查下方 workflow 门控后再启用。
- 若开发工作流要部署预览,fork 也要把 Pages 源设为 **GitHub Actions**;
  生产仓同理,首次部署前就要配好(`catalog.yml` 用的是
  `actions/deploy-pages`)。
- dev 运行只允许写 fork 的 catalog 分支与预览 Pages,或 dev 专用的索引仓
  副本。

### 5. 本地 remote 与服务端保护

默认推送目标是 fork,组织仓作为生产 upstream:

```bash
git remote set-url origin https://github.com/terry2010/awesome-opencode-market.git
git remote add upstream https://github.com/awesome-market/awesome-opencode-market.git
git branch --set-upstream-to=origin/main main
```

- 用组织 ruleset 保护生产 `main`:要求 PR 与通过检查,不给维护者账号
  常规 bypass。
- ruleset 只作用于 `main`,不要套到 `catalog`:目录发布器需要直接推
  `catalog`。
- 本地 `pre-push` hook 只是提醒,不是安全边界,可以被绕过。真正的保护靠
  服务端 ruleset 和最小权限凭据。
- 当前 launchd 任务并未加载。以后如果要加本地定时任务,指向 dev checkout
  并显式传 dev 目标。

## workflow 归属与环境门

每个 workflow 应在文件顶部标注它的运行位置——用仓库组合表示,常见取值:

| 运行位置 | 例子 |
|---|---|
| 生产仓 + fork 都跑 | 单元测试、类型检查、lint |
| 只在 fork | 手动 npm 发现/验证实验、预览部署 |
| 只在组织仓 | 定时 catalog/验证、正式投稿处理、生产站点与目录发布 |

标注的是**意图**(这份 workflow 该在哪边跑),实际执行仍靠下面的仓库
门控兜底。两边的 workflow 数量和内容可以不同,不必对齐。

有副作用的 job 按精确仓库名 fail-closed 判断,两个方向都要写——只写
dev-only 条件保护不了生产仓:

```yaml
# 仅生产
if: github.repository == 'awesome-market/awesome-opencode-market'

# 仅开发
if: github.repository == 'terry2010/awesome-opencode-market'
```

- 在两边都跑的 job 不需要仓库门控,但其输出必须限定在所运行的仓库内。
- 不要因为 workflow 用了 `GH_REPO: ${{ github.repository }}` 就认为安全;
  `MARKET_REPO_URL`、Pages URL、跨仓推送目标等显式目的地也要校验。
- fork 的定时工作流要显式决定开关。启用 Actions 后 `catalog`、`verify`、
  `submit`、`docket` 的 schedule 全会在 fork 上跑;`docket` 还有
  `workflow_run` 触发器,会在 fork 的 catalog/verify 跑完后自动接力。
- `spike.yml` 是纯手动的 P0 实验,建议标注"只在 fork"或从生产仓删除,
  留在 prod 只是噪音。
- `GITHUB_TOKEN` 推送的 commit 不会触发新 workflow——catalog/verify 写
  `catalog` 分支不会引起循环;`ci.yml` 也只盯 `main` 分支的 push。
- issue 触发的工作流只作用于所在仓库的 issue。dev 的投稿和测试判定留在
  fork;不要给 fork workflow 配生产写凭据。

## 凭据

### GitHub

- 普通 Actions job 用自动发放、仓库级的 `GITHUB_TOKEN`;它不是手工配置的
  secret,也不用跨仓复制。
- 不配置 `MARKET_PAT`。`catalog.yml` 里已有
  `secrets.MARKET_PAT || secrets.GITHUB_TOKEN` 回退——secret 不存在时
  自动走 `GITHUB_TOKEN` 的 1000 req/h 读额度,够用。将来若 API 额度不够
  再考虑配置。
- 索引仓更新用**各自仓的定时 workflow**:拉取 market Pages 上公开的
  `index.json`,渲染分类 README,用本仓 `GITHUB_TOKEN` 提交——全程零
  跨仓凭据。渲染脚本放主仓,索引仓 curl 脚本(或其产物)跑一次。
  接受的代价:更新比 catalog 晚一个调度周期、每个索引仓多一个小
  workflow。若将来需要"发布即推"的实时性,再退到仅限那两个仓
  (Contents write)的 fine-grained PAT 或 GitHub App。生产凭据永不
  进 fork。

### npm

- 正式包无 scope:`awesome-opencode-market`;开发包保留
  `oc-market-quail-zephyr-72a0`。
- 两个包都要发布则各配 granular token,各自只授权对应包。prod token
  不进 fork,也不进 dev checkout 的 `.npmrc`。
- 只发生产版则只需一个生产凭据。当前 npm 发布是手动操作,没有任何
  workflow 消费 npm token。
- token 存放在 `~/.npmrc`;项目内 `.npmrc` 只放非密钥配置(如需要)。
- 不要用 sed 在共享工作区临时改包名发布。首次正式发版前定一个可复用的
  打包/发布流程,发前校验包名与版本。`0.0.1` 已被占位,下个生产版本
  必须更高。
- 以后若把发布搬进 GitHub Actions,考虑 npm trusted publishing(OIDC),
  绑定到生产仓与发布 workflow,避免存长期 token。

### 本地密钥

- AI 诊断密钥在 `~/.config/opencode-market/ai.env`,是本机文件,不在
  GitHub secrets 体系内——GitHub 的仓级隔离管不到它。本地定时任务(如
  启用)必须用 dev checkout 与 dev 凭据,避免本机密钥污染生产数据。

## 上线切换清单

仅在 fork 验证通过、生产仓就绪后执行:

1. 确认分支保护与仓库 Actions 权限设置。
2. 在组织仓启用 Actions。
3. 确认 Pages 源为 GitHub Actions,手动跑一次 catalog workflow,验证
   `catalog` 分支与 Pages 输出正确。
4. 更新**所有**生产 URL——代码里仍写着 spike 端点的位置:
   - 插件索引:`plugins/market/src/catalog.ts`
   - GUI/TUI 的 skills 源:`plugins/market/src/gui.ts`、
     `plugins/market/src/tui.tsx`
   - 日报链接:`pipeline/ai/digest.ts`、`bin/publish-digest.sh`
   - 站点源码链接:`pipeline/site/build.ts`
   - 文档里的角色描述:`docs/DEV.md` 仍称 spike 为"测试专用库",迁移后
     改写为 fork/prod 分工
5. 给生产包 manifest 补 `repository`、`bugs`、`homepage`;保持开发包
   身份独立。
6. 针对新 catalog 跑安装、更新、技能安装、卸载冒烟测试;确认插件与技能
   链接不再指向 spike。
7. `npm pack --dry-run` 核对包名、版本与包含的 README 后手动发下一版;
   `0.0.1` 占位无法用同版本覆盖。
8. 生产端点全部验证通过后,再把已发布插件的默认 index 与 skills URL
   切到生产地址。
9. plugin/skill 索引仓为后续阶段。建仓时从生产 catalog 生成分类
   README,并测试发布目标不可能误指 dev fork 或无关仓库。

## 待决策

- 索引仓的更新频率、提交者身份、dev 预览策略(建仓前再定)。

## 已定决策

- `broken-fixture` **迁**。它是与 main 无共同历史的孤立分支,只有一个
  commit:故意语法错误的 `index.js` + 名为 `broken-fixture` 的
  `package.json`——验证流水线"必炸包"夹具,留着以后测 `failed` 判定。
  推送时加进显式 ref 列表:`git push <prod-remote> main catalog broken-fixture`。
- plugin/skill 索引仓:**后续阶段**,首发不建。
