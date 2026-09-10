/**
 * 执行记录面板的自定义日志语言与配色。
 *
 * 日志是纯文本，但内容有明确结构（>> 请求、<< 响应、[时间]、[连接名]、
 * SQL 语句），因此注册一个 Monarch 语言做关键词高亮，比纯文本可读性高很多。
 *
 * 主题分暗/亮两套，跟随全局主题切换；编辑器背景设为全透明，
 * 让日志面板自身的背景色透出，避免出现色块割裂。
 */
import type * as Monaco from 'monaco-editor'

/** 日志语言 ID */
export const LOG_LANGUAGE_ID = 'toolbox-log'

/**
 * 应用统一的 Monaco 主题名。
 *
 * 重要：Monaco 的主题是全局的，任何编辑器设置主题都会影响所有编辑器。
 * 因此不能给日志单独一套主题——否则打开别的编辑器（如 SQL 模板管理里的
 * SQL 编辑器）时主题被切走，日志的自定义 token 颜色就会失效。
 * 这里统一成一套「继承 vs-dark / vs + 追加日志 token 规则」的主题。
 */
export const APP_THEME_DARK = 'toolbox-dark'
/** 亮色应用主题名 */
export const APP_THEME_LIGHT = 'toolbox-light'

/**
 * SQL 关键字，命中后高亮显示。
 * 小写书写即可，Monarch 的 ignoreCase 负责大小写不敏感匹配。
 */
const SQL_KEYWORDS = [
  'select', 'from', 'where', 'and', 'or', 'not', 'in', 'is', 'null', 'like', 'between',
  'insert', 'into', 'values', 'update', 'set', 'delete', 'truncate', 'replace',
  'join', 'inner', 'left', 'right', 'full', 'outer', 'cross', 'on', 'as',
  'group', 'by', 'order', 'having', 'limit', 'offset', 'union', 'all', 'distinct',
  'case', 'when', 'then', 'else', 'end', 'exists', 'asc', 'desc',
  'count', 'sum', 'avg', 'max', 'min', 'coalesce', 'cast', 'convert',
  'create', 'alter', 'drop', 'table', 'index', 'view', 'with', 'over', 'partition',
]

/** 暗色下的 token 颜色 */
const DARK_RULES: Monaco.editor.ITokenThemeRule[] = [
  { token: 'log-request', foreground: '38bdf8', fontStyle: 'bold' },
  { token: 'log-response', foreground: '34d399', fontStyle: 'bold' },
  { token: 'log-success', foreground: '34d399' },
  { token: 'log-error', foreground: 'f87171', fontStyle: 'bold' },
  { token: 'log-time', foreground: '64748b' },
  { token: 'log-conn', foreground: '94a3b8' },
  { token: 'log-keyword', foreground: 'c084fc' },
  { token: 'log-string', foreground: 'fbbf24' },
  { token: 'log-number', foreground: 'fbbf24' },
]

/** 亮色下的 token 颜色，整体加深以保证对比度 */
const LIGHT_RULES: Monaco.editor.ITokenThemeRule[] = [
  { token: 'log-request', foreground: '0284c7', fontStyle: 'bold' },
  { token: 'log-response', foreground: '15803d', fontStyle: 'bold' },
  { token: 'log-success', foreground: '15803d' },
  { token: 'log-error', foreground: 'dc2626', fontStyle: 'bold' },
  { token: 'log-time', foreground: '94a3b8' },
  { token: 'log-conn', foreground: '475569' },
  { token: 'log-keyword', foreground: '7c3aed' },
  { token: 'log-string', foreground: 'b45309' },
  { token: 'log-number', foreground: 'b45309' },
]

/**
 * 注册日志语言与主题。
 * 需在 Monaco 初始化后调用，重复调用会被忽略。
 */
export function registerLogLanguage(monaco: typeof Monaco) {
  if (monaco.languages.getLanguages().some(language => language.id === LOG_LANGUAGE_ID)) {
    return
  }

  monaco.languages.register({ id: LOG_LANGUAGE_ID })

  monaco.languages.setMonarchTokensProvider(LOG_LANGUAGE_ID, {
    // 大小写不敏感交给 Monarch 自身处理，比在正则上加 i 标志可靠
    ignoreCase: true,
    keywords: SQL_KEYWORDS,
    tokenizer: {
      root: [
        // 行首的请求 / 响应标记
        [/^>>/, 'log-request'],
        [/^<</, 'log-response'],

        // 结果关键字
        [/错误/, 'log-error'],
        [/成功/, 'log-success'],

        // [HH:mm:ss] 与 [连接名]
        [/\[\d{1,2}:\d{2}:\d{2}\]/, 'log-time'],
        [/\[[^\]\n]*\]/, 'log-conn'],

        // SQL 字面量
        [/'[^'\n]*'/, 'log-string'],
        [/\d+(?:\.\d+)?/, 'log-number'],

        // 标识符：命中关键字表则高亮，否则原样输出
        [/[A-Za-z_][\w$]*/, { cases: { '@keywords': 'log-keyword', '@default': '' } }],
      ],
    },
  })

  // 不覆盖 colors（空对象即可）：背景沿用 vs-dark / vs 的默认值，
  // 日志面板的透明底色由 ExecutionLog 的样式单独处理
  monaco.editor.defineTheme(APP_THEME_DARK, {
    base: 'vs-dark',
    inherit: true,
    rules: DARK_RULES,
    colors: {},
  })

  monaco.editor.defineTheme(APP_THEME_LIGHT, {
    base: 'vs',
    inherit: true,
    rules: LIGHT_RULES,
    colors: {},
  })
}
