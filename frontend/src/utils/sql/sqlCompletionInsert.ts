/**
 * 列候选的「勾选多选」与插入逻辑。
 *
 * 从 sqlCompletion.ts 拆出：多选状态、限定符补全、一次性插入多列，
 * 都只服务于「列名候选」这一件事，与作用域 / 候选生成无关。
 */
import type { Completion } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { BOOST_COLUMN } from './sqlCompletionKeywords'

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
export function columnItem(name: string, columnDetail: ColumnDetail): ColumnCompletion {
  return {
    label: name,
    type: 'field',
    boost: BOOST_COLUMN,
    apply: columnApply(name),
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
 */
function columnApply(label: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const marked = columnsMarked(view)
    const labels = marked.length ? marked : [label]
    const session = insertSessions.get(view)
    const continued = Boolean(session) && session?.head === from

    /*
     * 点号补全（`SELECT t1.`）时把已输入的限定符一起纳入替换范围，
     * 于是一次插入多列时每一列都会带上别名（`t1.a, t1.b`），
     * 而不是只有第一列沾了文档里那个 `t1.` 的光。
     */
    const qualifier = qualifierBeforeCursor(view.state.doc.toString(), from)
    const start = from - qualifier.length
    const insert = `${continued ? ', ' : ''}${labels.map(name => qualifier + name).join(', ')}`
    const head = start + insert.length

    view.dispatch({
      changes: { from: start, to, insert },
      selection: { anchor: head },
    })

    insertSessions.set(view, { head })
    clearColumnMarks(view)
  }
}
