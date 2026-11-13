# OpenCode Market

[English](README.md) | 中文

在 OpenCode 里发现插件和技能，先了解它们的用途和测试情况，再直接安装。

![OpenCode Market 面板](https://raw.githubusercontent.com/awesome-market/awesome-opencode-market/main/docs/market-panel.png)

## 为什么做这个

OpenCode 的插件生态很大，但没有内置的应用市场。社区列表靠手工维护，大
多只能告诉你某个插件存在——没法告诉你它能不能装上、会影响什么。

Market 的目录是流水线自动生成的，不靠人工维护：5000+ 条目每小时经过
发现、扫描、AI 复核和实测安装，你看到的不是抄来的简介，而是实际的检
查结果。

## 开始使用

```bash
opencode plugin add awesome-opencode-market
```

随后在 TUI 里打开 **Market** 视图，或在 GUI 里打开 **Market** 面板
（GUI 插件目前是实验性的）。

需要较新的 OpenCode——本插件基于 `@opencode/plugin` 2.x。装完后 Market
视图始终不出现时，先检查 OpenCode 版本，再看 **Market → 高级** 里的
插件日志。

## 能看到什么

- **浏览和搜索**完整目录——按分类、按插件用到的 OpenCode 功能筛选
- **检查标签**——`verified` / `failed` / `skipped` / `unverified`，安装前
  用大白话说明含义。「没扫到」就写「没扫到」，绝不写成「安全」
- **一键安装和更新**——包括把所有有新版可装的插件一次更新完；一个包
  同时带插件和技能时，两半的状态分开显示
- **钉版安装**——装的就是审核过的那一份：npm 装 `name@批准版本`，
  GitHub 装 `owner/repo#<commit sha>`——绝不跟浮动的 `latest` 或 `HEAD`
- **GitHub 仓库直接收录**——没有 npm 包的 repo 按其审核过的 commit
  快照安装
- **技能**——插件之外也能发现和安装技能，每个技能的权限可单独控制
  （允许 / 询问 / 拒绝）
- **收藏**——标记想回头的条目；设置里可导出、恢复 JSON 备份
- **自己的目录**——通过插件 `indexUrl` 选项或 `OPENCODE_MARKET_INDEX`
  环境变量指向镜像或私有索引
- **双语**——中文和 English，选择会被记住

## 一个条目上架前要过什么

每个条目在你能安装之前，走同一条流水线：

1. **发现**——npm 关键词、GitHub topic、投稿
2. **静态扫描**——包 tarball（或仓库的 commit 快照）对照公开规则集
   检查：凭据读取、网络外发、生命周期脚本、混淆、提示注入特征
3. **AI 复核**——扫描出的内容和包元数据交给审核模型；带红旗的条目
   只拿到一份给人工的草稿，AI 没有裁决权
4. **实测安装**——有可装部件的条目在沙箱里真实安装并加载
   （`verified` 的意思是装得上、起得来）
5. **日报公示窗**——`pass` 判词不立即放行：先在每日日报公示，异议
   可以在上架前提出
6. **放行**——公示窗结束才进入目录，成为可安装条目

客户端在唤起 `plugin add` 之前会再对一次当前目录——缓存窗口内刚被
标记的版本照样装不上。检查结果是参考信息，不代表软件一定安全——
请安装你信任的来源。

## 目录本身也是数据

Market 面板、TUI 和网站读的是同一份目录——所有界面背后同一个数据源：

- 机器可读的索引：
  `https://awesome-market.github.io/awesome-opencode-market/index.json`
- 技能文件目录：
  `https://awesome-market.github.io/awesome-opencode-market/skills/`
- [在网页上浏览目录](https://awesome-market.github.io/awesome-opencode-market/)
- [趋势榜单](https://opencode-plugins.zhuikan.com)——基于本目录数据做的
  star 增长/下载排行（上新、日/周/月榜、历史回看）
- [每日日报](https://github.com/awesome-market/awesome-opencode-market/tree/catalog/digest)
  ——上架预告面：每个将放行的版本先在这里公示，异议可在放行前提出

## 推荐插件或技能

[提交推荐](https://github.com/awesome-market/awesome-opencode-market/issues/new?template=submission.yml)
——投稿和其他条目一样，要先过扫描和实测安装，才会出现在目录里。

## 反馈

bug 和功能建议请提
[issue](https://github.com/awesome-market/awesome-opencode-market/issues)。
审核队列也在同一个 tracker 上——`[review]` 开头的 issue 就是自动流水
线标记出来、等人工裁决的条目。

[项目源码与详情](https://github.com/awesome-market/awesome-opencode-market) ·
[MIT 许可证](https://github.com/awesome-market/awesome-opencode-market/blob/main/LICENSE)
