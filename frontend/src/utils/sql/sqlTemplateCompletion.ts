/**
 * SQL 模板（`{{ … }}`）与 JavaScript 脚本模式的补全。
 *
 * 从 sqlCompletion.ts 拆出：这两条路径与 SQL 表/列解析毫无交集，
 * 只消费模板变量、模板函数与脚本全局标识符。
 *
 * ## 模板补全的几件事（T8 加固）
 *
 *  - **配对平衡检测**：`readTemplateContext` 不只判断「光标是不是在 `{{` 之后」，
 *    还会往前找最近的 `{{` / `}}`（谁更近用谁），并往后看片段是否已经有 `}}`。
 *    因此既知道片段的完整范围（块片段要整段替换），也知道插入时该不该补右括号。
 *  - **块片段**：`{{if}}`/`{{range}}`/`{{with}}` 的成对骨架，一次插入整块，
 *    光标落在条件处并立刻弹候选 —— 不用手写 `{{end}}`。
 *  - **函数文档**：候选项带 `detail`（签名）与 `info`（用法 / 说明 / 示例），
 *    编辑器右下的提示面板会展示 `info`（CSS 是 `pre-line`，多行可读）。
 *  - **else / end 辅助**：片段内给 `else` / `end` 关键字（按未闭合块栈决定给哪个），
 *    普通位置则直接给 `{{else}}` / `{{end}}` 收尾候选。
 */
import { startCompletion } from '@codemirror/autocomplete'
import type { Completion } from '@codemirror/autocomplete'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { inLiteralOrComment } from '@/utils/sql/sqlSyntax'
import { BOOST_CLAUSE_KEYWORD } from './sqlCompletionKeywords'
import type { CompletionBundle, TemplateVariable } from './sqlCompletion'

/** 模板上下文检测的回看长度：片段内容不会太长，避免全文扫描 */
const TEMPLATE_LOOKBACK = 400

/** 往后看多长来确认片段已经被 `}}` 闭合 */
const TEMPLATE_LOOKAHEAD = 40

/** 光标所在的模板片段 */
export interface TemplateContext {
  /** `{{` 之后到光标之间的文本 */
  fragment: string
  /** 候选替换起点（当前正在输入的变量名/函数名的词首） */
  from: number
  /** `{{` 在文档中的下标（块片段要整段替换，需要它） */
  openAt: number
  /** 片段的闭合 `}}` 下标；为 null 表示片段还没闭合（正在写） */
  closeAt: number | null
}

/**
 * 检测光标是否位于未闭合的 `{{ … }}` 内。
 *
 * 判定「未闭合」靠最近的标记：最近的 `{{` 比最近的 `}}` 更靠近光标才算在片段里；
 * 片段后面有没有 `}}` 由 `closeAt` 单独给出（它决定插入时要不要补右括号）。
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
  const after = state.doc.sliceString(pos, Math.min(pos + TEMPLATE_LOOKAHEAD, state.doc.length))
  const closeRel = after.indexOf('}}')
  return {
    fragment,
    from: pos - word.length,
    openAt: start + open,
    closeAt: closeRel < 0 ? null : pos + closeRel,
  }
}

/**
 * 光标是否处于模板片段内（触发策略要用）。
 *
 * 与补全的分派顺序保持一致：`'{{ device_no }}'` 这类引号内插值是最常见的写法，
 * 不能被「字符串里不弹」的判定拦掉。
 */
export function inTemplateFragment(state: EditorState, pos: number): boolean {
  return readTemplateContext(state, pos) !== null
}

// ---------------------------------------------------------------- 函数 / 指令文档

/** 一个模板函数或指令的文档 */
export interface TemplateFunctionDoc {
  /** 候选右侧的短签名 */
  signature: string
  /** 提示面板里的说明（可多行） */
  description: string
  /** 示例 */
  example: string
  /** 是否是块指令（if / range / with / else / end） */
  directive?: boolean
  /** 插入后是否补一个空格（要接参数的都补） */
  trailingSpace?: boolean
}

/**
 * 模板函数与指令（与后端 internal/utils/tplfunc.go 注册的自定义函数保持一致）。
 *
 * `detail` 用 signature、`info` 用「说明 + 示例」，这样列表里一眼能看出签名，
 * 选中项时右侧面板给出完整用法。
 */
const TEMPLATE_FUNCTIONS: Record<string, TemplateFunctionDoc> = {
  // ---- 自定义函数（后端注册）
  quote: {
    signature: 'quote 值',
    description: '按值类型加 SQL 引号：字符串 → \'值\'（内部单引号转义），数字 / 布尔原样输出，空值 → NULL。',
    example: 'WHERE device_name = {{ quote device_name }}',
    trailingSpace: true,
  },
  upper: {
    signature: 'upper 值',
    description: '把值转成大写。',
    example: 'WHERE code = {{ upper code }}',
    trailingSpace: true,
  },
  lower: {
    signature: 'lower 值',
    description: '把值转成小写。',
    example: 'WHERE code = {{ lower code }}',
    trailingSpace: true,
  },
  default: {
    signature: 'default "默认值" 值',
    description: '值为空（零值）时使用默认值；管道写法更常见：{{ 变量 | default "50" }}。',
    example: 'LIMIT {{ page_size | default "50" }}',
    trailingSpace: true,
  },
  join: {
    signature: 'join "分隔符" 数组',
    description: '把数组按分隔符拼成字符串，常配合 quote 拼 IN 列表。',
    example: "device_no in ('{{ join \"','\" device_list }}')",
    trailingSpace: true,
  },
  now: {
    signature: 'now "2006-01-02 15:04:05"',
    description: '按 Go 时间格式输出当前时间，参数留空默认 2006-01-02 15:04:05。',
    example: "AND create_time <= '{{ now \"2006-01-02 15:04:05\" }}'",
    trailingSpace: true,
  },
  in: {
    signature: 'in "a,b" 值',
    description: '判断值是否命中给定集合（逗号分隔的字符串），用于多环境 / 多类型判断。',
    example: '{{if in "prod,uat" env}} AND env_type = 1 {{end}}',
    trailingSpace: true,
  },

  // ---- 块指令
  if: {
    signature: 'if 条件',
    description: '条件为真时输出块内内容，必须以 {{end}} 收尾；可选一个 {{else}} 分支。',
    example: '{{if device_no}} AND device_no = {{device_no}} {{end}}',
    directive: true,
    trailingSpace: true,
  },
  range: {
    signature: 'range 数组',
    description: '遍历数组，块内用 {{.}} 表示当前元素；带下标用 {{range $i, $v := 数组}}。',
    example: "device_no in ({{range device_list}}'{{.}}',{{end}}'')",
    directive: true,
    trailingSpace: true,
  },
  with: {
    signature: 'with 值',
    description: '值为非空时进入该作用域，块内可直接用 {{.字段}}。',
    example: '{{with device}} AND device_no = {{.device_no}} {{end}}',
    directive: true,
    trailingSpace: true,
  },

  // ---- 常用内置函数
  and: { signature: 'and 值1 值2 …', description: '全部为真才为真（遇假值即停止求值）。', example: '{{if and start_time end_time}} … {{end}}', trailingSpace: true },
  or: { signature: 'or 值1 值2 …', description: '任一为真即输出。', example: '{{if or keyword device_no}} … {{end}}', trailingSpace: true },
  not: { signature: 'not 值', description: '对单个值取反，常用于「变量为空时才拼接」。', example: '{{if not show_deleted}} AND deleted = 0 {{end}}', trailingSpace: true },
  eq: { signature: 'eq 值1 值2', description: '相等判断。', example: '{{if eq env "prod"}} … {{end}}', trailingSpace: true },
  ne: { signature: 'ne 值1 值2', description: '不等判断。', example: '{{if ne env "prod"}} … {{end}}', trailingSpace: true },
  lt: { signature: 'lt 值1 值2', description: '小于判断。', example: '{{if lt page_size 100}} … {{end}}', trailingSpace: true },
  gt: { signature: 'gt 值1 值2', description: '大于判断（常与 len 搭配判断非空）。', example: '{{if gt (len device_list) 0}} … {{end}}', trailingSpace: true },
  len: { signature: 'len 值', description: '取长度，配合 gt / eq 判断数组 / 字符串是否为空。', example: '{{if gt (len device_list) 0}} … {{end}}', trailingSpace: true },
  index: { signature: 'index 数组 下标', description: '按下标取值。', example: 'AND first_tag = {{ index tag_list 0 }}', trailingSpace: true },
  slice: { signature: 'slice 数组 起 止', description: '截取切片（下标从 0 开始，含起不含止）。', example: '{{range slice tag_list 0 3}} … {{end}}', trailingSpace: true },
  printf: { signature: 'printf "格式" 值',
    description: '按 Go 格式串拼接；SQL 里的 LIKE 模糊匹配常写成 printf "%%%s%%"（%% 转义为 %）。',
    example: "WHERE name LIKE '{{ printf \"%%%s%%\" keyword }}'",
    trailingSpace: true },
  print: { signature: 'print 值…', description: '原样打印（不做格式化）。', example: '{{print device_no}}', trailingSpace: true },
}

/**
 * 模板关键字 / 内置函数名：出现即表示光标在「变量参数」位置，只给变量。
 *
 * 块关键字与常见判断函数都在内，避免把函数名塞进参数位。
 * `else` / `end` 不作为常规候选（它们由 closingWordOptions 按块栈给），
 * 但必须留在本集合里：`{{else if |}}` 之后仍然只该给变量。
 */
const TEMPLATE_WORDS = new Set([
  ...Object.keys(TEMPLATE_FUNCTIONS),
  'else', 'end', 'define', 'block', 'template', 'break', 'continue',
])

/**
 * 模板候选：
 *  - `{{ | }}`：变量 + 函数 / 指令 + 块片段；
 *  - `{{if | }}` / `{{quote | }}` 等已有关键字或函数：只给变量（避免把函数名塞进参数位）；
 *  - `{{else}}` / `{{end}}`：不给候选（已经写完了）。
 */
export function templateBundle(
  context: TemplateContext,
  variables: TemplateVariable[],
  /** 到光标为止的未闭合块栈（由 templateBlockStack 求出） */
  blocks: TemplateBlock[] = [],
): CompletionBundle | null {
  const trimmed = context.fragment.trim()
  if (/^(else|end)$/i.test(trimmed)) {
    return null
  }

  const first = (trimmed.split(/[\s|(),"'`]+/).filter(Boolean)[0] ?? '').toLowerCase()
  const variableOnly = TEMPLATE_WORDS.has(first)

  // 变量永远排在最前（最常用），函数 / 指令与块片段随后，收尾关键字最后
  const options = templateVariableOptions(variables)
  if (!variableOnly) {
    options.push(...templateFunctionOptions())
    options.push(...blockSnippetOptions(context))
    options.push(...closingWordOptions(blocks))
  }
  return options.length ? { from: context.from, options, contextKind: 'template' } : null
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

/** 模板函数 / 指令候选项（带文档） */
function templateFunctionOptions(): Completion[] {
  return Object.entries(TEMPLATE_FUNCTIONS).map(([name, doc]) => ({
    label: name,
    type: doc.directive ? 'keyword' as const : 'function' as const,
    detail: doc.signature,
    info: functionInfo(doc),
    apply: templateApply(name, doc.trailingSpace ? ' ' : ''),
  }))
}

/** 提示面板里的文档文本（编辑器用 pre-line 渲染，换行即可读） */
function functionInfo(doc: TemplateFunctionDoc): string {
  return `${doc.description}\n示例：${doc.example}`
}

// ---------------------------------------------------------------- 块栈与块片段

/** 一个未闭合的模板块 */
export interface TemplateBlock {
  kind: 'if' | 'range' | 'with'
  /** 该 if 块是否已经有 else（模板语法里 if 只能有一个 else） */
  hasElse: boolean
}

/**
 * 扫描到文本末尾为止的块栈（栈顶是最内层未闭合的块）。
 *
 * 只统计**已经写完整**的指令（形如 `{{if …}}`，必须有闭合的 `}}`）：
 * 光标处正在写的 `{{if ` 还没成为块，不该让 `end` 提前出现。
 */
export function templateBlockStack(text: string): TemplateBlock[] {
  const stack: TemplateBlock[] = []
  for (const match of text.matchAll(/\{\{\s*([A-Za-z_]+)\b[^}]*\}\}/g)) {
    const name = (match[1] ?? '').toLowerCase()
    if (name === 'if' || name === 'range' || name === 'with') {
      stack.push({ kind: name, hasElse: false })
      continue
    }
    if (name === 'else') {
      const top = stack[stack.length - 1]
      if (top && top.kind === 'if') {
        top.hasElse = true
      }
      continue
    }
    if (name === 'end') {
      stack.pop()
    }
  }
  return stack
}

/** 块片段定义：一次插入成对骨架，光标落在条件处 */
interface BlockSnippet {
  label: string
  detail: string
  /** 块头（`if` / `range` / `with`） */
  open: string
  /** 块体首行内容 */
  body: string
  /** 是否带 else 分支 */
  withElse: boolean
}

const BLOCK_SNIPPETS: BlockSnippet[] = [
  { label: 'if 块', detail: '插入 {{if}} … {{end}} 骨架', open: 'if', body: '', withElse: false },
  { label: 'if / else 块', detail: '插入带 {{else}} 分支的条件块', open: 'if', body: '', withElse: true },
  { label: 'range 块', detail: '插入 {{range}} … {{end}} 骨架（块内 {{.}} 为当前元素）', open: 'range', body: '{{.}}', withElse: false },
  { label: 'with 块', detail: '插入 {{with}} … {{end}} 骨架（块内可直接用 {{.字段}}）', open: 'with', body: '', withElse: false },
]

/**
 * 块片段候选：整段替换当前 `{{ … }}`，插入可用的成对骨架。
 *
 * 光标停在块头条件处并立刻触发补全（`{{if |}}` → 变量列表），
 * 这样既不用手写 `{{end}}`，也不用记条件变量名。
 */
function blockSnippetOptions(context: TemplateContext): Completion[] {
  return BLOCK_SNIPPETS.map((snippet) => {
    return {
      label: snippet.label,
      type: 'text' as const,
      detail: snippet.detail,
      info: `用法示例：${snippet.open === 'if'
        ? '{{if 变量}} AND 条件 = {{变量}} {{end}}'
        : `{{${snippet.open} 变量}} … {{end}}`}`,
      apply: blockApply(context, snippet),
    }
  })
}

/** 当前行的缩进（含它所在的换行符之后的空白） */
function indentAt(state: EditorState, pos: number): string {
  const line = state.doc.lineAt(pos)
  return /^[\t ]*/.exec(line.text)?.[0] ?? ''
}

/**
 * 块片段的插入：把整个 `{{ … }}`（含已写出的闭合括号）换成成对骨架。
 *
 * 骨架按当前行缩进排版，光标落在块头条件处（`{{if |}}`），
 * 随后触发一次补全 —— 紧接着就能从变量列表里选条件。
 */
function blockApply(context: TemplateContext, snippet: BlockSnippet) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const state = view.state
    const indent = indentAt(state, context.openAt)
    // 片段里已经写了内容（如 `{{if x}}` 再改成 `range 块`）时，整段替换
    const start = context.openAt
    const end = context.closeAt === null ? to : context.closeAt + 2

    const head = `{{${snippet.open} }}`
    const lines: string[] = [head, `${indent}  ${snippet.body}`]
    if (snippet.withElse) {
      lines.push(`${indent}{{else}}`, `${indent}  `)
    }
    lines.push(`${indent}{{end}}`)

    const insert = lines.join('\n')
    // 光标停在块头条件处（`{{if |}}` 的竖线位置，也就是 head 里 `}}` 之前）
    const caret = start + head.length - 2

    view.dispatch({
      changes: { from: start, to: end, insert },
      selection: { anchor: caret },
    })

    triggerCompletion(view)
  }
}

/**
 * 片段内的收尾关键字：`else` / `end`。
 *
 * 按未闭合块栈决定：最内层是 if 且还没 else 才给 `else`；有未闭合块才给 `end`。
 * 选中后走普通插入（片段没闭合的话会自动补上 ` }}`）。
 */
function closingWordOptions(blocks: TemplateBlock[]): Completion[] {
  if (!blocks.length) {
    return []
  }
  const top = blocks[blocks.length - 1]
  const options: Completion[] = []

  if (top.kind === 'if' && !top.hasElse) {
    options.push({
      label: 'else',
      type: 'keyword',
      detail: `否则分支（闭合第 ${blocks.length} 层 if）`,
      info: '用法：{{if 条件}} … {{else}} … {{end}}',
      apply: templateApply('else'),
    })
  }
  options.push({
    label: 'end',
    type: 'keyword',
    detail: `闭合第 ${blocks.length} 层 ${top.kind} 块`,
    info: '用法：与最近的 {{if}} / {{range}} / {{with}} 配对',
    apply: templateApply('end'),
  })
  return options
}

/**
 * 普通位置（不在片段内）的收尾候选：直接给 `{{else}}` / `{{end}}`。
 *
 * 光标所在行的缩进已经写在光标左边，这里只补指令本身，
 * 所以插到空行上会自然对齐。
 */
export function templateClosingItems(state: EditorState, pos: number): Completion[] {
  const before = state.doc.sliceString(0, pos)
  const stack = templateBlockStack(before)
  if (!stack.length) {
    return []
  }

  const top = stack[stack.length - 1]
  const items: Completion[] = []
  if (top.kind === 'if' && !top.hasElse) {
    items.push(closingItem('{{else}}', '{{else}}',
      '补上否则分支', '用法：{{if 条件}} … {{else}} … {{end}}'))
  }
  items.push(closingItem('{{end}}', '{{end}}',
    `闭合最近的 ${top.kind} 块（还有 ${stack.length} 层未闭合）`,
    '用法：与最近的 {{if}} / {{range}} / {{with}} 配对'))
  return items
}

/** 普通位置的收尾候选（整条指令一次性写出） */
function closingItem(label: string, insert: string, detail: string, info: string): Completion {
  return {
    label,
    type: 'keyword',
    // 低于子句关键字：模板里的 SQL 候选仍然优先，收尾是顺手一用
    boost: BOOST_CLAUSE_KEYWORD - 5,
    detail,
    info,
    apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
      })
    },
  }
}

/**
 * 模板候选的插入行为：
 *  - 光标后已有 `}}`（允许中间有空白）→ 只插名字，不重复补闭合；
 *  - 否则补上 ` }}`，光标停在 `}}` 之前，方便继续输入。
 */
function templateApply(name: string, suffix = '') {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const doc = view.state.doc
    const after = doc.sliceString(to, Math.min(to + 3, doc.length))
    const closed = /^\s*\}\}/.test(after)
    // 片段已经闭合就只插名字；否则顺手补上右括号（片段正在写）
    const insert = closed ? `${name}${suffix}` : `${name}${suffix}}}`

    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + name.length + suffix.length },
    })
  }
}

/**
 * 插入完成后重新弹一次候选（更新周期内不能派发事务，所以延后一轮）。
 * 编辑器可能已经被销毁（切标签 / 关标签），照例子检查连接状态。
 */
function triggerCompletion(view: EditorView) {
  setTimeout(() => {
    if (view.dom?.isConnected) {
      startCompletion(view)
    }
  }, 0)
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
    contextKind: 'script',
  }
}
