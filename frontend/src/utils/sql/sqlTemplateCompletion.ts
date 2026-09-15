/**
 * SQL 模板（`{{ … }}`）与 JavaScript 脚本模式的补全。
 *
 * 从 sqlCompletion.ts 拆出：这两条路径与 SQL 表/列解析毫无交集，
 * 只消费模板变量与脚本全局标识符。
 */
import type { Completion } from '@codemirror/autocomplete'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { inLiteralOrComment } from '@/utils/sql/sqlSyntax'
import type { CompletionBundle, TemplateVariable } from './sqlCompletion'

/** 模板上下文检测的回看长度：标记不会离光标太远，避免全文扫描 */
const TEMPLATE_LOOKBACK = 30

/** 光标所在的未闭合模板片段 */
interface TemplateContext {
  /** `{{` 之后到光标之间的文本 */
  fragment: string
  /** 候选替换起点（当前正在输入的变量名/函数名的词首） */
  from: number
}

/**
 * 检测光标是否位于未闭合的 `{{ … }}` 内。
 *
 * 只看光标前 30 个字符，不做全文扫描；
 * 最后出现的 `}}` 在 `{{` 之后说明已经闭合，此时光标处在普通 SQL 位置。
 */
export function readTemplateContext(state: EditorState, pos: number): TemplateContext | null {
  const start = Math.max(0, pos - TEMPLATE_LOOKBACK)
  const text = state.doc.sliceString(start, pos)
  const open = text.lastIndexOf('{{')
  if (open < 0) {
    return null
  }
  if (text.lastIndexOf('}}') > open) {
    return null
  }

  const fragment = text.slice(open + 2)
  const word = /[A-Za-z_][\w]*$/.exec(fragment)?.[0] ?? ''
  return { fragment, from: pos - word.length }
}

/** 模板函数（与后端 internal/utils/tplfunc.go 注册的 7 个保持一致） */
const TEMPLATE_FUNCTIONS: Record<string, string> = {
  quote: 'quote 值 → 按类型加 SQL 引号',
  upper: 'upper 值 → 转大写',
  lower: 'lower 值 → 转小写',
  default: 'default "默认值" 值 → 空值兜底',
  join: 'join "分隔符" 数组 → 拼接',
  now: 'now "2006-01-02" → 当前时间',
  in: 'in "a,b" 值 → 集合判断',
}

/** 模板关键字 / 内置函数名：出现即表示光标在「变量参数」位置，只给变量 */
const TEMPLATE_WORDS = new Set([
  ...Object.keys(TEMPLATE_FUNCTIONS),
  'if', 'else', 'end', 'range', 'with', 'not', 'and', 'or',
  'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'len', 'index', 'slice', 'printf', 'print',
])

/**
 * 模板候选：
 *  - `{{ | }}`：变量 + 模板函数；
 *  - `{{if | }}` / `{{quote | }}` 等已有关键字或函数：只给变量（避免把函数名塞进参数位）；
 *  - `{{else}}` / `{{end}}`：不给候选。
 */
export function templateBundle(
  context: TemplateContext,
  variables: TemplateVariable[],
): CompletionBundle | null {
  const trimmed = context.fragment.trim()
  if (/^(else|end)$/i.test(trimmed)) {
    return null
  }

  const first = (trimmed.split(/[\s|(),"'`]+/).filter(Boolean)[0] ?? '').toLowerCase()
  const variableOnly = TEMPLATE_WORDS.has(first)

  const options = templateVariableOptions(variables)
  if (!variableOnly) {
    options.push(...templateFunctionOptions())
  }
  return options.length ? { from: context.from, options } : null
}

/** 模板变量候选项（type 用 variable，靠 detail 与 SQL 别名区分） */
function templateVariableOptions(variables: TemplateVariable[]): Completion[] {
  return variables.map(item => ({
    label: item.name,
    type: 'variable',
    detail: item.label && item.label !== item.name ? `模板变量 · ${item.label}` : '模板变量',
    apply: templateApply(item.name),
  }))
}

/** 模板函数候选项 */
function templateFunctionOptions(): Completion[] {
  return Object.entries(TEMPLATE_FUNCTIONS).map(([name, detail]) => ({
    label: name,
    type: 'function',
    detail,
    apply: templateApply(name),
  }))
}

/**
 * 模板候选的插入行为：
 *  - 光标后已有 `}}`（允许中间有空白）→ 只插名字，不重复补闭合；
 *  - 否则补上 ` }}`，光标停在 `}}` 之前，方便继续输入。
 */
function templateApply(name: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const doc = view.state.doc
    const after = doc.sliceString(to, Math.min(to + 3, doc.length))
    const closed = /^\s*\}\}/.test(after)
    const insert = closed ? name : `${name} }}`

    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + name.length },
    })
  }
}

/**
 * 脚本模式：注入的全局标识符（variables / rows / sqlTemplate …）。
 */
export function scriptBundle(
  state: EditorState,
  pos: number,
  globals: string[],
): CompletionBundle | null {
  // 字符串 / 注释里不打扰（lang-javascript 的节点名与 SQL 一致）
  if (inLiteralOrComment(state, pos)) {
    return null
  }
  if (!globals.length) {
    return null
  }

  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  const word = /[A-Za-z_$][\w$]*$/.exec(before)?.[0] ?? ''

  return {
    from: pos - word.length,
    options: globals.map(name => ({
      label: name,
      type: 'variable',
      detail: '脚本变量',
    })),
  }
}
