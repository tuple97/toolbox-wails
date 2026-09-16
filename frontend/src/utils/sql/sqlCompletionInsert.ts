/**
 * 列候选的「勾选多选」与插入逻辑。
 *
 * 从 sqlCompletion.ts 拆出：多选状态、限定符补全、一次性插入多列、
 * 标识符的引用符处理，都只服务于「把列名正确写进文档」这一件事，
 * 与作用域 / 候选生成无关。
 */
import type { Completion } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { BOOST_COLUMN, RESERVED_WORDS } from './sqlCompletionKeywords'
import { quoteIdent } from './rowSql'
import type { SqlDialect } from './rowSql'

// ---------------------------------------------------------------- 标识符引用

/** 纯标识符写法：不以数字开头、只含字母数字下划线美元符 */
const PLAIN_IDENT_RE = /^[A-Za-z_][\w$]*$/

/**
 * 该标识符不加引用符就会出错：不是纯标识符写法（含空格 / 短横线 / 中文等），
 * 或命中保留字（`order`、`key`、`user` 这类列名很常见）。
 */
export function needsQuoting(name: string): boolean {
  return !PLAIN_IDENT_RE.test(name) || RESERVED_WORDS.has(name.toLowerCase())
}

/**
 * 标识符的落地写法。
 *
 * `quote` 是用户自己敲下的引号（`` ` `` / `"` / `[`）：敲了就用他的样式并配对着闭合，
 * 没敲则只在必要时（保留字 / 非纯标识符）才加引用符，保持 SQL 干净。
 */
export function renderIdent(name: string, dialect: SqlDialect, quote?: string): string {
  if (quote) {
    const close = quote === '[' ? ']' : quote
    return `${quote}${name.split(quote).join(quote + quote)}${close}`
  }
  return needsQuoting(name) ? quoteIdent(name, dialect) : name
}

/** 光标左侧紧邻的开引号（含它自己的起止位置） */
export interface OpeningQuote {
  /** 开引号字符 */
  quote: string
  /** 配对的闭引号 */
  close: string
  /** 开引号在文档中的下标 */
  start: number
}

/**
 * 光标左侧是不是一个**开引号**。
 *
 * 用户常先敲引号再打名字（`` `na ``）：插入时要把这个引号一起替换掉、
 * 并补上右引号，否则文档里会留下 `` `name `` 这种没闭合的写法。
 *
 * 判断「开」而不是「闭」的依据：引号左边紧邻的是标识符字符时（`` `name` `` 的第二个引号），
 * 那是收尾用的闭引号，不属于本次替换范围。
 */
export function openingQuoteBefore(text: string, from: number): OpeningQuote | null {
  const quote = text[from - 1]
  if (quote !== '`' && quote !== '"' && quote !== '[') {
    return null
  }
  const before = text[from - 2] ?? ''
  if (/[\w$\u4e00-\u9fa5]/.test(before)) {
    return null
  }
  return { quote, close: quote === '[' ? ']' : quote, start: from - 1 }
}

/**
 * 「总是带引号」的候选（表名 / 库名）的插入：吃掉用户已经敲下的开引号。
 *
 * 不处理的话，用户敲 `` `us `` 选中 users 会得到 `` ``users` ``（两个引号）。
 */
export function quotedIdentApply(identifier: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const open = openingQuoteBefore(view.state.doc.toString(), from)
    const start = open ? open.start : from
    view.dispatch({
      changes: { from: start, to, insert: identifier },
      selection: { anchor: start + identifier.length },
    })
  }
}

/** 列候选项的描述片段：提示栏里分段渲染并配图标（见 CodeEditor.vue 的 renderColumnDetail） */
export interface ColumnDetail {
  /** 完整类型（varchar(32)） */
  dataType?: string
  /** 来源表 / 别名 */
  from?: string
  /** 字段注释 */
  comment?: string
}

/** 带列描述的补全项：CM6 会把同一个对象交给渲染回调，附加字段可安全携带 */
export interface ColumnCompletion extends Completion {
  columnDetail?: ColumnDetail
}

/**
 * 列名候选项（**所有列名都必须经由这里构造**）。
 *
 * 普通补全（Ctrl+Space / 输入中）与点号补全两条路径都会用到它；
 * 一旦漏掉 `apply`，回车时就会退回 CM6 的默认「只插入标签本身」，
 * 勾选的多列不会被一起插入（曾踩过：普通补全那条路径漏了 apply，
 * 表现为「勾选多个后回车只出来刚回车的那一条」）。
 *
 * 描述（类型 / 来源 / 注释）不放 `detail`：那是纯文本，只能串成一串 `·`；
 * 改挂在 columnDetail 上，由编辑器渲染成「图标 + 文本」的分段。
 */
export function columnItem(
  name: string,
  columnDetail: ColumnDetail,
  dialect: SqlDialect,
): ColumnCompletion {
  return {
    label: name,
    type: 'field',
    boost: BOOST_COLUMN,
    apply: columnApply(name, dialect),
    columnDetail,
  }
}

/**
 * 列名的「勾选多选」状态。
 *
 * CM6 原生不支持补全多选（`acceptCompletion` 一次只应用一项），这里自己维护一份
 * 勾选状态，配合编辑器封装层实现：
 *  - 候选项左侧的复选框：CodeEditor.vue 通过 autocompletion 的 `addToOptions` 渲染；
 *  - 空格切换勾选：CodeEditor.vue 的键位；
 *  - 回车生成：勾选项由下面的 `columnApply` 一次性插入，用 ", " 连接
 *    （没有勾选时就是当前这一项，行为与普通补全一致）。
 *
 * 勾选状态属于「本次筛选」：补全源被重新查询（输入字符、重新打开列表）即清空，
 * 避免界面上看不见旧勾选却被悄悄插入。
 */
const markedColumns = new WeakMap<EditorView, string[]>()
/** 上一次插入结束的光标位置，用于判断是否要补 ", " */
const insertSessions = new WeakMap<EditorView, { head: number }>()

/** 已勾选的列（按勾选顺序；只读，勿直接修改） */
export function columnsMarked(view: EditorView): string[] {
  return markedColumns.get(view) ?? []
}

/** 某列是否已勾选 */
export function isColumnMarked(view: EditorView, label: string): boolean {
  return columnsMarked(view).includes(label)
}

/** 切换勾选，返回切换后的状态 */
export function toggleColumnMark(view: EditorView, label: string): boolean {
  const current = columnsMarked(view)
  const next = current.includes(label)
    ? current.filter(item => item !== label)
    : [...current, label]
  markedColumns.set(view, next)
  return next.includes(label)
}

/** 清空勾选（插入完成后调用） */
export function clearColumnMarks(view: EditorView) {
  markedColumns.delete(view)
}

/** 限定符回看长度：别名不会离光标太远，避免全文扫描 */
const QUALIFIER_LOOKBACK = 128

/** 光标左侧的限定符：`t1.`、`` `db`.`t`. `` 等，允许点号前有多段 */
const QUALIFIER_BEFORE = /(?:(?:`[^`]*`|"[^"]*"|[A-Za-z_$][\w$]*)\.)+$/

/**
 * 读出补全替换起点左侧紧邻的限定符（含点号），没有则返回空串。
 *
 * 这里传的应是补全的替换起点（当前正在输入的词的首字符，`sqlBundle` 的 `from`），
 * 而不是光标位置——点号补全时 `t1.` 正好贴在它左边。
 * 点号补全的候选项 label 只有列名，插入时靠它把别名补回去；抽成纯函数便于单测。
 */
export function qualifierBeforeCursor(text: string, from: number): string {
  const start = Math.max(0, from - QUALIFIER_LOOKBACK)
  return QUALIFIER_BEFORE.exec(text.slice(start, from))?.[0] ?? ''
}

/**
 * 列名插入逻辑。
 *
 * 勾选了多项就一次插入全部（", " 连接）；没勾选只插入当前项。
 * 紧接在上一次插入之后（中间没有手动输入）时自动补一个 ", "，
 * 所以连续挑列不会粘在一起。
 *
 * 引号由 renderIdent 统一处理：用户已敲开引号就沿用并闭合，否则只在必要时加。
 */
function columnApply(label: string, dialect: SqlDialect) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const marked = columnsMarked(view)
    const labels = marked.length ? marked : [label]
    const session = insertSessions.get(view)
    const continued = Boolean(session) && session?.head === from

    const doc = view.state.doc.toString()
    // 用户可能先敲了开引号（`` `na ``）：把引号一并纳入替换，插入时补上右引号
    const open = openingQuoteBefore(doc, from)
    const wordStart = open ? open.start : from

    /*
     * 点号补全（`SELECT t1.`）时把已输入的限定符一起纳入替换范围，
     * 于是一次插入多列时每一列都会带上别名（`t1.a, t1.b`），
     * 而不是只有第一列沾了文档里那个 `t1.` 的光。
     * 限定符在开引号左边，所以从 wordStart 往左读。
     */
    const qualifier = qualifierBeforeCursor(doc, wordStart)
    const start = wordStart - qualifier.length
    const names = labels.map(name => `${qualifier}${renderIdent(name, dialect, open?.quote)}`)
    const insert = `${continued ? ', ' : ''}${names.join(', ')}`
    const head = start + insert.length

    view.dispatch({
      changes: { from: start, to, insert },
      selection: { anchor: head },
    })

    insertSessions.set(view, { head })
    clearColumnMarks(view)
  }
}
