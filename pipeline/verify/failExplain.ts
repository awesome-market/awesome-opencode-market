/** Plain-language explainers for verify-fail excerpts — shared by diagnose
 *  (verdict reason) and docket (issue body). A failed slot gets a mechanical
 *  concern verdict; the REASON still has to answer "装不上是为啥" for a human
 *  reviewer who should not need to read runner logs. Signatures are ordered
 *  most-specific first — ambient harness noise (watcher EACCES, models.dev)
 *  must never classify, so pickFailLine skips it before matching. */

// keep in sync with verify.ts's NOISE — lines a human never needs to judge on
const NOISE = /models\.dev|failed to watch directory|watcher (started|stopped|subscribe)/i
const MARKER = /^---\s*(errors|stream tail)\s*---$/i

/** Harness/ambient noise — filterable at render so legacy excerpts (stored
 *  before verify.ts grew the filter) stop occupying issue lines too. */
export const isHarnessNoise = (l: string): boolean => NOISE.test(l)
export const isSectionMarker = (l: string): boolean => MARKER.test(l.trim())

/** First log line worth judging by: error-shaped, not a section marker, not
 *  harness noise, not a bare JSON blob line. Returns '' when nothing qualifies. */
export function pickFailLine(log: string): string {
  for (const raw of log.split('\n')) {
    const l = raw.trim()
    if (!l || MARKER.test(l) || NOISE.test(l)) continue
    if (l.startsWith('{') || l.startsWith('[')) continue
    if (/error|failed|cannot|exception|ENOENT|EACCES|not found|denied|SyntaxError|TypeError|SchemaError|timeout|timed out|LoadError/i.test(l)) {
      return l
    }
  }
  return ''
}

/** Extract the semantic payload of a structured log line — `message="..."` /
 *  `cause="..."` fields carry the meaning; the `timestamp= level= run=`
 *  boilerplate around them just eats the display budget. */
export function unwrapLogLine(l: string): string {
  const msg = l.match(/message="((?:[^"\\]|\\.)*)"/)?.[1]
  const cause = l.match(/cause="((?:[^"\\]|\\.)*)"/)?.[1]
  if (msg || cause) return `${msg ?? ''}${cause ? ` — ${cause}` : ''}`.trim()
  return l
}

const SIGNATURES: [RegExp, string][] = [
  [/PluginModule\.LoadError|failed to load plugin|plugin absent from|reports the plugin failed/i,
    '插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本）'],
  [/SchemaError/i, '插件导出未通过 opencode 插件契约校验（schema 校验失败）'],
  [/MODULE_NOT_FOUND|Cannot find module/i, '依赖缺失——代码引用了不在包内的模块'],
  [/NpmInstallFailed|dep.*preparation.*failed|npm ERR!/i, '依赖安装失败（npm/git 拉取或包准备阶段报错）'],
  [/SyntaxError/i, '语法错误——插件代码无法解析'],
  [/tmux.*(exit|died|closed)|session.*exit/i, '交互界面启动即退出（进程在启动阶段崩溃）'],
  [/ETIMEDOUT|ESOCKETTIMEDOUT|timed?\s*out|deadline exceeded/i, '超时——安装或启动超出时限（可能是网络或包体过大）'],
  [/ENOENT/i, '文件缺失（ENOENT）——包内引用不存在的路径'],
  [/EACCES|permission denied|EACCES/i, '权限被拒（文件/端口权限或打包路径问题）'],
  [/plugin entry stuck/i, '插件卡在非终态——加载流程未完成'],
]

/** One-sentence human explanation of the failure signature; '' when the
 *  excerpt matches nothing known — callers fall back to the raw line. */
export function explainVerifyFail(level: string | undefined, line: string): string {
  const hit = SIGNATURES.find(([re]) => re.test(line))?.[1]
  if (hit) return hit
  if (level === 'interactive') return '交互式启动检查未通过——TUI 阶段异常退出'
  return ''
}
