/** Plain-language explainers for scan findings and sec:* identity flags —
 *  shared by docket (issue body 红旗清单/扫描摘录) and site build (detail
 *  page findings block). fmtFinding serializes only `rule:file — L:n: line`;
 *  the rule's own `detail` string never reaches stored data, so the
 *  explanation has to be re-attached at render time from the rule id.
 *  Each entry answers the two questions a reviewer actually asks:
 *  "为什么这条会报警" and "我该去核实什么". */

export interface FlagExplain { zh: string; en: string }

// scanner rule ids (pipeline/scan/rules.ts) — key is the text before the
// first ':' in a finding string
const RULES: Record<string, FlagExplain> = {
  'lifecycle-script': {
    zh: 'npm install 时自动执行的生命周期脚本——核实它只编译/链接，不联网、不读凭据、不写包外路径',
    en: 'script auto-runs during npm install — verify it only builds, never phones home or touches credentials',
  },
  'pack-script': {
    zh: 'npm pack/publish 阶段脚本——跑在发布者机器上，核实没有把敏感文件打进包里',
    en: 'pack/publish-stage script — runs on the publisher machine; check nothing sensitive is packed',
  },
  'prepare-script': {
    zh: '"prepare" 在 git/tarball 安装时自动执行——常见于编译产物，核实不联网、不执行外部命令',
    en: '"prepare" auto-runs on git/tarball install — usually a build step; verify no network/exec side effects',
  },
  'network-call': {
    zh: '网络请求——核实目标域名与插件功能相符，没有外发本地数据',
    en: 'network call — verify the destination matches plugin functionality and no local data leaves',
  },
  'literal-ip': {
    zh: '硬编码 IP 地址——域名可查归属，IP 不行；核实它指向什么服务',
    en: 'hard-coded IP — unlike a domain it hides ownership; verify what service it points to',
  },
  'obfuscation': {
    zh: '混淆/动态解码代码——自动化工具读不出意图，高危：需要人工还原逻辑再判',
    en: 'obfuscated/dynamically-decoded code — intent unreadable; needs manual deobfuscation before judging',
  },
  'base64-blob': {
    zh: '大段 base64 内容——核实解码后是资源数据还是隐藏的可执行逻辑',
    en: 'large base64 blob — verify it decodes to inert data, not hidden executable logic',
  },
  'credential-read': {
    zh: '读取凭据/keychain/环境密钥的路径——核实读取后的去向（只本地使用还是外发）',
    en: 'reads credential/keychain paths — verify the secret stays local and is never transmitted',
  },
  'install-pipe': {
    zh: '文档/说明里让用户执行远程脚本的安装方式（curl|bash）——用户侧行为，非插件运行时外联；安装面本身值得人工知悉',
    en: 'doc tells the USER to pipe a remote script to a shell (curl|bash) — user-side install method, not plugin runtime egress; still worth knowing',
  },
  'child-process': {
    zh: '启动子进程——核实执行的命令是否固定、参数是否被外部输入污染',
    en: 'spawns a child process — verify the command is fixed and its args can\'t be polluted by input',
  },
  'eval-call': {
    zh: 'eval/动态执行——核实被执行字符串来源完全可控',
    en: 'eval/dynamic execution — verify the evaluated string is fully controlled',
  },
  'docs-example': {
    zh: '文档/示例路径里的命中——多为说明性代码，通常良性，扫一眼确认非可执行内容',
    en: 'hit inside a doc/example path — usually illustrative; glance to confirm it is not executable',
  },
}

// identity-level flags (pipeline/run.ts, publish/merge.ts, review.ts) — key
// is the flag id before its own ':value' payload
const SEC: Record<string, FlagExplain> = {
  'repo-moved-since-release': {
    zh: '仓库 HEAD 在上架钉版后移动（参数为新提交 sha）——install 跟随 HEAD，装到的会是未复审字节；对照下方 delta 块核实变更是否良性',
    en: 'repo HEAD moved after the released pin (value = new sha) — installs follow HEAD, so new bytes are unreviewed; check the delta above',
  },
  'repo-moved-since-review': {
    zh: '仓库 HEAD 在上次人工复审后移动——需要按新 sha 复审',
    en: 'repo HEAD moved since the last human review — the new sha needs re-review',
  },
  'repo-recreated': {
    zh: '仓库被删除重建（历史不可信，可能换仓冒名）——需要重新全量审查，不能沿用旧信任',
    en: 'repo was deleted and recreated — history is untrustworthy; a full fresh review is required',
  },
  'repo-declared-mismatch': {
    zh: '清单声明的仓库地址与 registry 元数据不一致——可能冒名或错配，核实真实归属',
    en: 'manifest-declared repo differs from registry metadata — possible impersonation; verify real ownership',
  },
  'repo-dir-traversal': {
    zh: 'repository.directory 指向仓库根之外——可伪装他包路径，核实真实意图',
    en: 'repository.directory escapes the repo root — can disguise provenance; verify intent',
  },
  'repo-mismatch': {
    zh: '仓库内 package.json 的包名与 npm 包名不一致——核实是否同一项目',
    en: 'package.json name inside the repo differs from the npm name — verify it is the same project',
  },
  'repo-pkg-changed': {
    zh: '仓库内 package.json 相对上次记录被改动——核实变更内容',
    en: 'the repo\'s package.json changed since last recorded — review what changed',
  },
  'integrity-drift': {
    zh: '同版本号的字节指纹发生变化（换包/re-tag）——钉版失效，新字节未审',
    en: 'the same version\'s bytes changed (re-tag/package swap) — the pin is void; new bytes are unreviewed',
  },
  'name-reused': {
    zh: '这个包名曾被另一个包占用——警惕名称抢注/供应链寄生',
    en: 'this name was previously owned by a different package — beware name-squatting',
  },
  'version-rollback': {
    zh: '上游版本号发生回退——可能是发布事故或被篡改，核实版本历史',
    en: 'upstream version went backwards — release accident or tampering; check version history',
  },
  'maintainer-changed': {
    zh: '维护者名单发生变化——投毒常见前置信号，核实新维护者可信度',
    en: 'maintainer list changed — a common precursor to supply-chain takeover; vet the new maintainer',
  },
  'evidence-regressed': {
    zh: '新版本的证据链弱于旧版本（扫描/验证覆盖倒退）——按更弱证据对待',
    en: 'newer version has weaker evidence than the previous one — treat accordingly',
  },
  'tree-truncated': {
    zh: '文件树超出扫描上限被截断——存在未扫到的文件，「没扫到」不等于安全',
    en: 'file tree exceeded scan limits and was truncated — unscanned files remain; absence of findings ≠ safe',
  },
}

/** Explain one findings/redFlags string. Returns null for unknown ids —
 *  renderers fall back to the raw string, never to nothing. */
export function explainFlag(flag: string): FlagExplain | null {
  if (flag.startsWith('sec-delta:')) {
    const rule = flag.slice('sec-delta:'.length).split(':')[0] ?? ''
    const inner = RULES[rule]
    return {
      zh: `版本增量扫描命中规则 ${rule}${inner ? `——${inner.zh}` : ''}（只覆盖本次变更文件）`,
      en: `delta-scan hit ${rule}${inner ? ` — ${inner.en}` : ''} (covers changed files only)`,
    }
  }
  if (flag.startsWith('sec:')) {
    const id = flag.slice(4).split(/[:@]/)[0] ?? ''
    return SEC[id] ?? null
  }
  const rule = flag.split(':')[0] ?? ''
  return RULES[rule] ?? null
}
