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
/** 极夜黑主题名 */
export const APP_THEME_MIDNIGHT = 'toolbox-midnight'
/** IDEA Darcula 主题名 */
export const APP_THEME_IDEA = 'toolbox-idea'
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
 * IDEA Darcula 风格的 token 颜色。
 * 尽量贴近 IntelliJ 默认暗色方案：关键字橙、字符串绿、数字蓝。
 */
const IDEA_RULES: Monaco.editor.ITokenThemeRule[] = [
  { token: 'log-request', foreground: 'cc7832', fontStyle: 'bold' },
  { token: 'log-response', foreground: '6a8759', fontStyle: 'bold' },
  { token: 'log-success', foreground: '6a8759' },
  { token: 'log-error', foreground: 'e05561', fontStyle: 'bold' },
  { token: 'log-time', foreground: '606366' },
  { token: 'log-conn', foreground: 'a9b7c6' },
  { token: 'log-keyword', foreground: 'cc7832' },
  { token: 'log-string', foreground: '6a8759' },
  { token: 'log-number', foreground: '6897bb' },
]

/** 一种应用主题对应的编辑器调色板（与 styles/global.css 的同名主题一致） */
interface EditorPalette {
  base: 'vs' | 'vs-dark'
  rules: Monaco.editor.ITokenThemeRule[]
  /** 编辑器背景 */
  background: string
  /** 默认前景色 */
  foreground: string
  /** 行号 */
  lineNumber: string
  /** 当前行号 */
  lineNumberActive: string
  /** 光标 */
  cursor: string
  /** 选区 */
  selection: string
  /** 当前行高亮 */
  lineHighlight: string
  /** 浮层（补全、悬停）背景 */
  widget: string
  /** 边框 / 分隔线 */
  border: string
  /** 强调色（补全命中等） */
  accent: string
  /** 滚动条滑块 */
  scrollbar: string
  /** 滚动条滑块（悬停/拖动） */
  scrollbarHover: string
}

/** 各主题的编辑器配色 */
const PALETTES: Record<string, EditorPalette> = {
  [APP_THEME_DARK]: {
    base: 'vs-dark',
    rules: DARK_RULES,
    background: '0f172a',
    foreground: 'e2e8f0',
    lineNumber: '475569',
    lineNumberActive: '94a3b8',
    cursor: '38bdf8',
    selection: '38bdf840',
    lineHighlight: 'ffffff0a',
    widget: '16213c',
    border: 'ffffff1a',
    accent: '38bdf8',
    scrollbar: 'ffffff1f',
    scrollbarHover: 'ffffff33',
  },
  [APP_THEME_MIDNIGHT]: {
    base: 'vs-dark',
    rules: DARK_RULES,
    background: '0a0a0c',
    foreground: 'e8e8ea',
    lineNumber: '3f3f46',
    lineNumberActive: 'a1a1aa',
    cursor: '7dd3fc',
    selection: '7dd3fc40',
    lineHighlight: 'ffffff08',
    widget: '16161a',
    border: 'ffffff1f',
    accent: '7dd3fc',
    scrollbar: 'ffffff1f',
    scrollbarHover: 'ffffff33',
  },
  [APP_THEME_IDEA]: {
    base: 'vs-dark',
    rules: IDEA_RULES,
    background: '2b2b2b',
    foreground: 'a9b7c6',
    lineNumber: '606366',
    lineNumberActive: 'a1a1aa',
    cursor: 'cc7832',
    selection: 'cc783233',
    lineHighlight: 'ffffff08',
    widget: '3c3f41',
    border: 'ffffff1a',
    accent: 'cc7832',
    scrollbar: 'ffffff1f',
    scrollbarHover: 'ffffff33',
  },
  [APP_THEME_LIGHT]: {
    base: 'vs',
    rules: LIGHT_RULES,
    background: 'f1f5f9',
    foreground: '1e293b',
    lineNumber: '94a3b8',
    lineNumberActive: '475569',
    cursor: '0284c7',
    selection: '0284c733',
    lineHighlight: '0f172a0a',
    widget: 'ffffff',
    border: '0f172a1f',
    accent: '0284c7',
    scrollbar: '0f172a26',
    scrollbarHover: '0f172a40',
  },
}

/**
 * 把调色板展开成 Monaco 需要的 colors 表。
 *
 * 重要：colors 的值必须是完整的 CSS 颜色（带 `#`）。
 * Monaco 内部 `Color.fromHex` 解析失败时会**兜底成红色**，
 * 漏写 `#` 会让整个编辑器变成红背景、行号变红。
 * （token 规则的 foreground 则相反，不能带 `#`。）
 */
function toMonacoColors(palette: EditorPalette): Record<string, string> {
  const hex = (value: string) => `#${value}`

  return {
    'editor.background': hex(palette.background),
    'editor.foreground': hex(palette.foreground),
    'editorCursor.foreground': hex(palette.cursor),
    'editor.selectionBackground': hex(palette.selection),
    'editor.inactiveSelectionBackground': hex(palette.selection),
    'editor.lineHighlightBackground': hex(palette.lineHighlight),
    'editorLineNumber.foreground': hex(palette.lineNumber),
    'editorLineNumber.activeForeground': hex(palette.lineNumberActive),
    'editorIndentGuide.background1': hex(palette.border),
    'editorIndentGuide.activeBackground1': hex(palette.lineNumberActive),
    'editorGutter.background': hex(palette.background),
    'editorWidget.background': hex(palette.widget),
    'editorWidget.border': hex(palette.border),
    'editorSuggestWidget.background': hex(palette.widget),
    'editorSuggestWidget.border': hex(palette.border),
    'editorSuggestWidget.selectedBackground': hex(palette.selection),
    'editorSuggestWidget.highlightForeground': hex(palette.accent),
    'editorHoverWidget.background': hex(palette.widget),
    'editorHoverWidget.border': hex(palette.border),
    'editorBracketMatch.background': hex(palette.selection),
    'editorBracketMatch.border': hex(palette.lineNumberActive),
    'scrollbarSlider.background': hex(palette.scrollbar),
    'scrollbarSlider.hoverBackground': hex(palette.scrollbarHover),
    'scrollbarSlider.activeBackground': hex(palette.scrollbarHover),
    'minimap.background': hex(palette.background),
  }
}

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

  // 每个应用主题注册一套编辑器主题，背景与调色板保持一致
  for (const [name, palette] of Object.entries(PALETTES)) {
    monaco.editor.defineTheme(name, {
      base: palette.base,
      inherit: true,
      rules: palette.rules,
      colors: toMonacoColors(palette),
    })
  }
}
