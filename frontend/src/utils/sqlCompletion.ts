/**
 * SQL 智能补全（CodeMirror 6）：表名 / 字段（含别名 `u.`）/ 库名（`mydb.` → 该库的表）
 * / 关键字 / 函数。
 *
 * 设计要点：
 *  - **按位置给候选**（`readClauseKind` 反向扫描出最近的同级子句关键字）：
 *    - `FROM |` / `JOIN |` / `INTO |` / `FROM t, |`（表名还没写）→ **只给表与库**；
 *    - `FROM t |`（表已写）→ 表 + 库 + 关键字（JOIN / WHERE… 正是接下来要写的）；
 *    - `SELECT |` / `WHERE |` / `ON |` / `SET |` / `BY |` → 列 + 别名 + 函数 + 关键字；
 *    - 判断不出（语句开头、`FROM (`）→ 表 + 库 + 函数 + 关键字。
 *    子句判定用容错扫描而不是语法树：补全时语句往往没写完，而这里只需回答
 *    「最近的同级子句关键字是哪个、它后面是否已经有内容」，扫描比半成品语法树稳。
 *  - 字符串 / 注释内不弹补全（`inLiteralOrComment`，语法树判定）。
 *  - 补全源由编辑器实例通过 `createSqlCompletion(getView)` 装配；只有命令执行器会
 *    用 `registerCompletionContext` 登记上下文，其余编辑器（SQL 模板、执行记录）
 *    拿到空结果，行为保持不变。
 *  - 元数据统一由 `stores/metadataStore.ts` 缓存（TTL 5 分钟）：
 *    `connId` → 库列表；`connId:库` → 表列表；`connId:库:表` → 字段。
 *    缺失时后台异步拉取，本次补全立即用已有数据返回，绝不阻塞输入；
 *    连接管理页刷新元数据后，这里会立刻用到新数据。
 *  - **作用域按子查询分层**：靠语法树（`sqlSyntax.ts` 的 scopeRanges）拿到
 *    嵌套括号节点，逐层向上收集，内层别名优先（语句范围来自 sqlStatementRanges）；
 *    「光标所在的最内层子查询 → … → 外层语句」的范围链，每层单独解析表引用；
 *    因此子查询里的别名优先于外层同名别名（符合 SQL 作用域规则），
 *    也支持相关子查询（相关子查询里内层可以用外层表的字段）。
 *  - 点号补全的限定符按「**逐层别名 > 逐层无别名 CTE 名 > 显式 `库.表.` > 当前库表名 > 库名**」
 *    解析；派生表 `(SELECT …) 别名` 与 CTE 的输出列由轻量静态解析得出
 *    （`AS 别名` / `t.col` / 别名跟随 / 显式列清单），含 `*` 或无法命名的表达式时
 *    按「列未知」处理，补全退化为空。
 *  - 别名 / 派生表 / CTE 这些**语义**仍用容错扫描（`collectTableRefs`）而不是语法树：
 *    补全时语句通常还没写完（正打到 `where u.`），语法树只有语法节点、没有别名语义，
 *    而这套扫描对半成品语句更宽容。
 *  - 普通补全（Ctrl+Space / 输入中）在表/别名/库/关键字/函数之外，
 *    还给出各层来源（含派生表/CTE）的字段，按名字去重。
 */
import { startCompletion } from '@codemirror/autocomplete'
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { useMetadataStore } from '@/stores/metadataStore'
import { statementAtCursor } from '@/utils/sqlStatementRanges'
import { inLiteralOrComment, scopeRanges } from '@/utils/sqlSyntax'
import { dialectOf, quoteIdent } from '@/utils/rowSql'
import type { SqlDialect } from '@/utils/rowSql'
import type { ExecutorColumn } from '@/types'

/** 编辑器模型 → 所属命令执行器的连接、库与方言（getter，切换连接自动生效） */
type ContextGetter = () => { connId: number, database: string, dbType: string }

/**
 * 编辑器实例 → 补全上下文。
 *
 * 键必须是 EditorView 而不是 EditorState：CM6 里任何 dispatch（含 Compartment
 * 重配置主题）都会产生新的 EditorState，用 state 做键会在切换主题后丢上下文。
 */
const viewContexts = new WeakMap<EditorView, ContextGetter>()

/** 为某个编辑器登记补全上下文（命令执行器挂载时调用） */
export function registerCompletionContext(view: EditorView, getContext: ContextGetter) {
  viewContexts.set(view, getContext)
}

/** 编辑器销毁时注销 */
export function unregisterCompletionContext(view: EditorView | null) {
  if (view) {
    viewContexts.delete(view)
  }
}

/**
 * 创建补全源。
 *
 * CompletionSource 拿不到 EditorView，因此由编辑器封装层（CodeEditor.vue）
 * 以闭包形式把 view 传进来，再回查上面登记上下文。
 *
 * 没有登记上下文时（SQL 模板编辑器等非命令执行器场景）退化为
 * 「关键字 + 函数」静态补全，而不是返回空——否则那个编辑器里一条提示都没有。
 */
export function createSqlCompletion(getView: () => EditorView | null): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const view = getView()
    if (!view) {
      return null
    }
    // 每次重新查询都重置勾选（勾选只属于这一次筛选）
    clearColumnMarks(view)

    const getContext = viewContexts.get(view)
    if (!getContext) {
      return staticSuggestions(context)
    }
    return complete(context, getContext)
  }
}

/** 没有连接上下文时的静态补全：SQL 关键字 + 常用函数 */
function staticSuggestions(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const lineBefore = line.text.slice(0, context.pos - line.from)
  const word = /[A-Za-z0-9_$]*$/.exec(lineBefore)?.[0] ?? ''

  const options: Completion[] = [
    ...SQL_KEYWORDS.map(label => ({ label, type: 'keyword' })),
    ...Object.entries(SQL_FUNCTIONS).map(([label, detail]) => ({
      label,
      type: 'function',
      detail,
      apply: `${label}()`,
    })),
  ]

  return {
    from: context.pos - word.length,
    options,
    validFor: /^[\w$]*$/,
  }
}

/** 根据光标位置与补全上下文生成候选 */
function complete(
  context: CompletionContext,
  getContext: ContextGetter,
): CompletionResult | null {
  const { connId, database, dbType } = getContext()
  if (!connId) {
    return null
  }

  /*
   * 字符串 / 注释里不弹补全（语法树判定，见 inLiteralOrComment）：
   * 否则在 `-- 写点什么` 或 `'abc'` 里打字会一直冒表名与列名。
   */
  if (inLiteralOrComment(context.state, context.pos)) {
    return null
  }

  const dialect = dialectOf(dbType)
  const doc = context.state.doc.toString()
  const line = context.state.doc.lineAt(context.pos)
  const lineBefore = line.text.slice(0, context.pos - line.from)

  // 光标前正在输入的标识符片段（点号补全时通常为空）
  const word = /[A-Za-z0-9_$]*$/.exec(lineBefore)?.[0] ?? ''
  const from = context.pos - word.length

  /*
   * 作用域链（由内到外）：内层子查询 → 外层语句。整段脚本里其它语句的别名
   * 不会出现在链上，所以不会互相污染；子查询里则能同时看到内外两层的表。
   */
  const scopes = scopeRanges(context.state, context.pos, doc, dbType)
    .map(range => collectTableRefs(doc.slice(range.from, range.to)))
  const refs = scopes.flat()

  const qualifier = readQualifierBeforeCursor(lineBefore)
  const options = qualifier
    ? resolveAfterDot(qualifier, scopes, connId, database, dialect)
    : generalSuggestions(
        refs,
        connId,
        database,
        dialect,
        readClauseKind(currentClausePrefix(doc, context.pos, dbType)),
      )

  if (!options.length) {
    // 返回 null 让已打开的补全弹层正常关闭（列未知时不报错）
    return null
  }

  return {
    from,
    options,
    // 继续输入标识符时在本地过滤，避免每次都重新查询元数据
    validFor: /^[\w$]*$/,
  }
}

// ---------------------------------------------------------------- 点号补全

/**
 * 解析点号前的限定符。
 *
 * 支持 `u.`、`user.`、`` `mydb`. ``、`mydb.user.`、`"db"."t".` 等写法，
 * 返回已去引号的各段（最后一个就是紧邻点号的限定符）。
 * 光标前没有紧邻点号时返回 null。
 */
function readQualifierBeforeCursor(lineBefore: string): string[] | null {
  let index = lineBefore.length
  // 允许字母数字、_、$、点号与三种引号
  while (index > 0 && /[A-Za-z0-9_$."`[\]]/.test(lineBefore[index - 1] ?? '')) {
    index--
  }
  const raw = lineBefore.slice(index)
  if (!raw.endsWith('.')) {
    return null
  }
  const segments = raw
    .slice(0, -1)
    .split('.')
    .map(part => part.trim().replace(/^[`"[]/, '').replace(/[`"\]]$/, ''))
    .filter(Boolean)
  return segments.length ? segments : null
}

/**
 * 点号后的补全：按「逐层别名 > 逐层无别名 CTE 名 > 显式 `库.表.` > 当前库表名 > 库名」
 * 解析限定符。
 *
 * `scopes` 由内到外排列（最内层子查询在前），所以内层的别名会遮蔽外层同名别名；
 * 每层都没命中时再落到「表名 / 库名」这类与作用域无关的规则上。
 *
 * - 命中某层的别名 → 该别名指向的库/表的字段（支持跨库与派生表/CTE）；
 * - 命中某层无别名引用的 CTE 名 → 该 CTE 的输出列；
 * - 命中 `库.表.` 这种显式两段 → 直接按该库取字段；
 * - 命中当前库的表名 → 该表字段；
 * - 命中库名 → 该库的表列表；
 * - 都没命中：仍按「当前库的表」试一次（表列表可能还在后台加载，
 *   顺带把缓存预热起来），拿不到就是空列表，不报错。
 */
function resolveAfterDot(
  segments: string[],
  scopes: TableRef[][],
  connId: number,
  database: string,
  dialect: SqlDialect,
): Completion[] {
  const last = segments[segments.length - 1]
  const qualifier = last.toLowerCase()

  // 1) 逐层找别名（派生表 / CTE 的列来自静态解析，物理表走元数据）
  for (const refs of scopes) {
    const matchedRef = refs.find(ref => ref.alias.toLowerCase() === qualifier)
    if (matchedRef) {
      const virtual = matchedRef.virtualColumns
      if (virtual) {
        return virtualColumnSuggestions(virtual, matchedRef.alias)
      }
      return columnSuggestions(connId, matchedRef.schema || database, matchedRef.table)
    }
  }

  // 2) 逐层找无别名的 CTE 名（FROM cte → cte.）
  for (const refs of scopes) {
    const cteRef = refs.find(
      ref => !ref.alias && ref.table.toLowerCase() === qualifier && ref.virtualColumns,
    )
    if (cteRef?.virtualColumns) {
      return virtualColumnSuggestions(cteRef.virtualColumns, cteRef.table)
    }
  }

  // 3) 显式两段（mydb.user.）：倒数第二段是库/模式名
  if (segments.length > 1) {
    const schema = segments[segments.length - 2]
    return columnSuggestions(connId, schema, last)
  }

  // 4) 当前库里的表名
  if (ensureTables(connId, database).some(name => name.toLowerCase() === qualifier)) {
    return columnSuggestions(connId, database, last)
  }

  // 5) 库名 → 该库的表
  if (ensureDatabases(connId).some(name => name.toLowerCase() === qualifier)) {
    return tableSuggestions(connId, last, dialect)
  }

  // 6) 兜底：按当前库的表取字段（顺带预热缓存）
  return columnSuggestions(connId, database, last)
}

/**
 * 列名候选项（**所有列名都必须经由这里构造**）。
 *
 * 普通补全（Ctrl+Space / 输入中）与点号补全两条路径都会用到它；
 * 一旦漏掉 `apply`，回车时就会退回 CM6 的默认「只插入标签本身」，
 * 勾选的多列不会被一起插入（曾踩过：普通补全那条路径漏了 apply，
 * 表现为「勾选多个后回车只出来刚回车的那一条」）。
 */
function columnItem(name: string, detail: string): Completion {
  return {
    label: name,
    type: 'field',
    detail,
    apply: columnApply(name),
  }
}

/** 字段补全项（某张表的列） */
function columnSuggestions(
  connId: number,
  database: string,
  table: string,
): Completion[] {
  return ensureColumns(connId, database, table).map(column => columnItem(
    column.name,
    column.comment ? `${column.dataType} · ${column.comment}` : column.dataType,
  ))
}

/** 派生表 / CTE 的字段补全（列名来自静态解析，不查元数据） */
function virtualColumnSuggestions(columns: string[], source: string): Completion[] {
  return columns.map(name => columnItem(name, `${source} · 派生列`))
}

/**
 * 列名的「勾选多选」。
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
    const insert = `${continued ? ', ' : ''}${labels.join(', ')}`
    const head = from + insert.length

    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: head },
    })

    insertSessions.set(view, { head })
    clearColumnMarks(view)
  }
}

/** 表补全项 */
function tableSuggestions(
  connId: number,
  database: string,
  dialect: SqlDialect,
): Completion[] {
  return ensureTables(connId, database).map(table => ({
    label: table,
    type: 'class',
    detail: '表 / 视图',
    apply: quoteIdent(table, dialect),
  }))
}

// ---------------------------------------------------------------- 普通补全

/**
 * 插入文本后自动触发下一轮补全。
 *
 * 用于「选完库名 / 别名后紧接着选表 / 字段」：插入后等一帧再 startCompletion，
 * 否则补全弹层刚被这次插入关掉，立刻重开会闪。
 */
function applyAndTrigger(insertText: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    view.dispatch({
      changes: { from, to, insert: insertText },
      selection: { anchor: from + insertText.length },
    })
    setTimeout(() => startCompletion(view), 0)
  }
}

// ---------------------------------------------------------------- 子句上下文（决定候选类型）

/**
 * 补全所处子句的候选类型。
 *  - `source`：**表名还没写**（`FROM |`、`JOIN |`、`INTO |`、`FROM t, |`）→ 只给表与库
 *  - `afterSource`：表来源已写（`FROM t |`）→ 表 + 库 + 关键字（JOIN / WHERE…）
 *  - `column`：表达式位置（SELECT / WHERE / ON / SET / BY…）
 *  - `any`：判断不出（语句开头、`FROM (` 等）
 */
type ClauseKind = 'source' | 'afterSource' | 'column' | 'any'

/** 「后面接表」的子句关键字 */
const TABLE_CLAUSE_KEYWORDS = new Set([
  'from', 'join', 'into', 'update', 'table', 'truncate', 'describe',
  'use', 'database', 'schema', 'rename', 'analyze', 'optimize', 'repair',
])

/**
 * 「后面接列 / 表达式」的子句关键字。
 * `desc` / `limit` / `offset` 故意不收：它们后面接的是值或者别的关键字，
 * 而且 `order by x desc` 收尾时反向扫描还要继续往左找 BY，才能判成列位置。
 */
const COLUMN_CLAUSE_KEYWORDS = new Set([
  'select', 'where', 'on', 'and', 'or', 'set', 'by', 'having', 'using',
  'when', 'then', 'else', 'case', 'like', 'in', 'between', 'is', 'not',
  'distinct', 'returning', 'values', 'as', 'order', 'group',
])

/**
 * 判断光标处属于哪个子句。
 *
 * 用「光标前的同一语句文本 + 反向扫描」而不是完整语法树：
 *  - 补全时语句十有八九还没写完（正打到 `where u.`），严格 parser 会直接解析失败；
 *    MySQL / PostgreSQL 要两套语法，体积也远大于补全本身；
 *  - 这里只需要回答一个问题——**最近的、同层级的子句关键字是哪个**，
 *    反向扫几行文本就够，而且天然容错。
 *
 * 扫描时维护括号深度：子查询里的关键字不影响外层；字符串 / 注释 / 引号标识符整体跳过。
 * 进了括号要按表达式处理（函数参数、子查询列清单），
 * 但 `INSERT INTO t (` / `CREATE TABLE t (` 后面是列清单，同样是列位置。
 */
function readClauseKind(prefix: string): ClauseKind {
  let index = prefix.length
  let depth = 0
  /** 反向扫描时是否跨过了一个左括号 */
  let enteredParen = false

  while (index > 0) {
    const ch = prefix[index - 1] ?? ''

    if (/\s/.test(ch)) {
      index--
      continue
    }

    if (ch === ')') {
      depth++
      index--
      continue
    }

    if (ch === '(') {
      enteredParen = true
      depth = Math.max(0, depth - 1)
      index--
      continue
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      index = skipQuotedBackward(prefix, index - 1)
      continue
    }

    // 行注释：跳到行首；块注释：跳到 /* 之前
    if (ch === '-' && prefix[index - 2] === '-') {
      const lineStart = prefix.lastIndexOf('\n', index - 1)
      index = lineStart < 0 ? 0 : lineStart
      continue
    }
    if (ch === '/' && prefix[index - 2] === '*') {
      const blockStart = prefix.lastIndexOf('/*', index - 3)
      index = blockStart < 0 ? 0 : blockStart
      continue
    }

    const word = readWordBackward(prefix, index)
    if (word) {
      const lower = word.text.toLowerCase()
      if (depth === 0) {
        // 括号里的列清单：INSERT INTO t (a, |) / CREATE TABLE t (a |)
        if (enteredParen && (lower === 'into' || lower === 'update' || lower === 'table')) {
          return 'column'
        }
        if (TABLE_CLAUSE_KEYWORDS.has(lower)) {
          /*
           * 表位置再细分：关键字到光标之间有没有内容，决定了「表还没写」还是「已写了表」。
           * `FROM |` → source（只给表/库）；`FROM t |` → afterSource（再给 JOIN/WHERE 等关键字）；
           * `FROM t, |` → 逗号后面又该接表名，回到 source。
           */
          const tail = prefix.slice(index).trim()
          if (!tail || tail.endsWith(',')) {
            return 'source'
          }
          if (tail.includes('(') || tail.includes(')')) {
            return 'any'
          }
          return 'afterSource'
        }
        if (COLUMN_CLAUSE_KEYWORDS.has(lower)) {
          return 'column'
        }
      }
      index = word.start
      continue
    }

    index--
  }

  // 进了括号又判断不出关键字：按表达式位置处理（函数参数、子查询列清单等）
  return enteredParen ? 'column' : 'any'
}

/** 从 index 向左读一个词，返回词与起始下标 */
function readWordBackward(text: string, index: number): { text: string, start: number } | null {
  let i = index
  while (i > 0 && /[\w$]/.test(text[i - 1] ?? '')) {
    i--
  }
  if (i === index || !/[A-Za-z_$]/.test(text[i] ?? '')) {
    return null
  }
  return { text: text.slice(i, index), start: i }
}

/** 从 index（引号字符）向左找到配对的开引号，返回开引号之前的下标 */
function skipQuotedBackward(text: string, index: number): number {
  const quote = text[index] ?? ''
  let i = index - 1
  while (i >= 0) {
    if (text[i] === quote) {
      // 双写（''）或反斜杠转义：继续往左找
      if (text[i - 1] === quote || text[i - 1] === '\\') {
        i -= 2
        continue
      }
      return i
    }
    i--
  }
  return 0
}

/**
 * 光标所在（可能还没写完）语句中，光标之前的文本。
 *
 * 光标不在任何语句内（在空行上起新语句）时从上一个分号之后算起，
 * 否则开头处会把**上一条语句**的子句当成上下文（在 FROM 后面之后接着弹列名）。
 */
function currentClausePrefix(doc: string, pos: number, dbType = ''): string {
  const statement = statementAtCursor(doc, pos, dbType)
  const start = statement ? statement.from : doc.lastIndexOf(';', pos - 1) + 1
  return doc.slice(Math.max(0, start), pos)
}

/**
 * 非点号场景（Ctrl+Space / 输入中）按子句上下文给候选：
 *  - `source`：**只给表与库**——表名还没写，这时冒 JOIN / WHERE 之类的关键字纯属干扰；
 *  - `afterSource`：表 + 库 + 关键字（JOIN / WHERE / GROUP BY… 正是接下来要写的）；
 *  - `column`：列 → 别名 → 函数 → 关键字；
 *  - `any`：表 → 库 → 函数 → 关键字。
 */
function generalSuggestions(
  refs: TableRef[],
  connId: number,
  database: string,
  dialect: SqlDialect,
  kind: ClauseKind,
): Completion[] {
  const suggestions: Completion[] = []

  if (kind === 'column') {
    // 字段：各作用域的来源（物理表 + 派生表/CTE），按名字去重
    const seenColumns = new Set<string>()
    for (const ref of refs) {
      const source = ref.alias || ref.table
      if (ref.virtualColumns) {
        for (const name of ref.virtualColumns) {
          const key = name.toLowerCase()
          if (seenColumns.has(key)) {
            continue
          }
          seenColumns.add(key)
          suggestions.push(columnItem(name, `${source} · 派生列`))
        }
        continue
      }
      for (const column of ensureColumns(connId, ref.schema || database, ref.table)) {
        const key = column.name.toLowerCase()
        if (seenColumns.has(key)) {
          continue
        }
        seenColumns.add(key)
        suggestions.push(columnItem(
          column.name,
          `${source} · ${column.dataType}${column.comment ? ` · ${column.comment}` : ''}`,
        ))
      }
    }

    // 语句里已定义的别名 / 无别名的 CTE：选它自动补上点号并继续弹字段
    for (const ref of refs) {
      const name = ref.alias || (ref.virtualColumns ? ref.table : '')
      if (!name) {
        continue
      }
      suggestions.push({
        label: name,
        type: 'variable',
        detail: ref.virtualColumns
          ? `派生表 / CTE（${ref.virtualColumns.length} 列）`
          : ref.schema
            ? `别名 → ${ref.schema}.${ref.table}`
            : `别名 → ${ref.table}`,
        apply: applyAndTrigger(`${name}.`),
      })
    }
  }

  if (kind !== 'column') {
    suggestions.push(...tableSuggestions(connId, database, dialect))
    suggestions.push(...namespaceSuggestions(connId, dialect))
  }

  // 表名还没写：只给表与库，别让关键字把表名候选挤下去
  if (kind === 'source') {
    return suggestions
  }

  for (const keyword of SQL_KEYWORDS) {
    suggestions.push({
      label: keyword,
      type: 'keyword',
    })
  }

  // 函数只在可能出现表达式的位置给：表位置与「表之后」都用不到
  if (kind === 'any' || kind === 'column') {
    for (const [name, signature] of Object.entries(SQL_FUNCTIONS)) {
      suggestions.push({
        label: name,
        type: 'function',
        detail: signature,
        apply: `${name}()`,
      })
    }
  }

  return suggestions
}

/** 库名候选：选中后自动补点号并再弹一次（接着就能选该库的表） */
function namespaceSuggestions(connId: number, dialect: SqlDialect): Completion[] {
  return ensureDatabases(connId).map(name => ({
    label: name,
    type: 'namespace',
    detail: '数据库',
    apply: applyAndTrigger(`${quoteIdent(name, dialect)}.`),
  }))
}

// ---------------------------------------------------------------- 元数据（统一走 metadataStore）

/**
 * 元数据缓存已收敛到 `stores/metadataStore.ts`：
 * 连接管理页的「查看 / 刷新元数据」与这里的补全共用同一份数据，
 * 刷新后补全立即生效，不会各存一份。
 *
 * 下面三个包装保持「同步返回缓存 + 后台补齐」的语义不变：
 * 补全候选必须立刻返回，绝不等待网络。
 */
function ensureTables(connId: number, database: string): string[] {
  return metadata().ensureTables(connId, database)
}

function ensureColumns(connId: number, database: string, table: string): ExecutorColumn[] {
  return metadata().ensureColumns(connId, database, table)
}

function ensureDatabases(connId: number): string[] {
  return metadata().ensureDatabases(connId)
}

/**
 * 延迟解析 store 实例。
 *
 * 这些函数都在补全回调（用户输入）里执行，此时 pinia 已激活；
 * 但模块加载期不能调用 useMetadataStore()，因此这里惰性获取并缓存。
 */
let metadataStore: ReturnType<typeof useMetadataStore> | null = null
function metadata(): ReturnType<typeof useMetadataStore> {
  metadataStore ??= useMetadataStore()
  return metadataStore
}

// ---------------------------------------------------------------- 语句解析

/** 表引用：库/模式名（空表示未限定）、表名、别名（空表示无别名） */
interface TableRef {
  schema: string
  table: string
  alias: string
  /** 派生表 / CTE 静态解析出的输出列；物理表为 undefined，走元数据查询 */
  virtualColumns?: string[]
}

/** 别名位置不能出现的关键字（命中即认为这张表没有别名） */
const NON_ALIAS_KEYWORDS = new Set([
  'where', 'group', 'order', 'having', 'limit', 'offset', 'union', 'join',
  'left', 'right', 'inner', 'outer', 'cross', 'full', 'on', 'using', 'set',
  'values', 'as', 'and', 'or', 'when', 'then', 'else', 'end', 'for', 'lock',
  'window', 'qualify', 'into', 'from', 'select', 'with', 'asc', 'desc', 'is',
  'not', 'null', 'in', 'exists', 'straight_join', 'force', 'use', 'ignore',
])

/** 跳过空白 */
function skipSpaces(text: string, index: number): number {
  let i = index
  while (i < text.length && /\s/.test(text[i] ?? '')) {
    i++
  }
  return i
}

/**
 * 读取一个标识符，支持裸名字与 `` `x` `` / `"x"` / `[x]` 三种引用
 * （重复引号按转义处理）。读不到时返回 null。
 */
function readIdentifier(text: string, index: number): { name: string, end: number } | null {
  const quote = text[index]
  if (quote === '`' || quote === '"' || quote === '[') {
    const close = quote === '[' ? ']' : quote
    let i = index + 1
    let name = ''
    while (i < text.length) {
      if (text[i] === close) {
        if (text[i + 1] === close) {
          name += close
          i += 2
          continue
        }
        return { name, end: i + 1 }
      }
      name += text[i]
      i++
    }
    return null
  }

  if (!/[A-Za-z_$]/.test(text[index] ?? '')) {
    return null
  }
  let i = index + 1
  while (i < text.length && /[\w$]/.test(text[i] ?? '')) {
    i++
  }
  return { name: text.slice(index, i), end: i }
}

/** 读取限定名（最多三段，点号分隔），如 `mydb`.`user` */
function readQualifiedName(text: string, start: number): { parts: string[], end: number } | null {
  let index = skipSpaces(text, start)
  const first = readIdentifier(text, index)
  if (!first) {
    return null
  }

  const parts = [first.name]
  index = first.end
  for (let i = 0; i < 2; i++) {
    const dot = skipSpaces(text, index)
    if (text[dot] !== '.') {
      break
    }
    const next = readIdentifier(text, skipSpaces(text, dot + 1))
    if (!next) {
      break
    }
    parts.push(next.name)
    index = next.end
  }
  return { parts, end: index }
}

/** 读取别名：`AS x` 或紧跟的裸标识符（关键字不算别名） */
function readAlias(text: string, start: number): { alias: string, end: number } | null {
  const index = skipSpaces(text, start)

  if (/^as\b/i.test(text.slice(index, index + 3))) {
    const ident = readIdentifier(text, skipSpaces(text, index + 2))
    return ident ? { alias: ident.name, end: ident.end } : null
  }

  const ident = readIdentifier(text, index)
  if (!ident || NON_ALIAS_KEYWORDS.has(ident.name.toLowerCase())) {
    return null
  }
  return { alias: ident.name, end: ident.end }
}

/**
 * 收集语句中的表引用（含别名）。
 *
 * 扫描 FROM / JOIN / UPDATE / INSERT INTO / DELETE FROM 之后的限定名，
 * FROM 后面的逗号多表也支持；`(SELECT …) 别名` 派生表会静态解析出输出列，
 * WITH 定义的 CTE 按名字登记（`FROM cte`、`FROM cte x` 都能命中）。
 */
function collectTableRefs(statement: string): TableRef[] {
  const refs: TableRef[] = []
  const intro = /\b(?:from|join|update|insert\s+into|delete\s+from)\b/gi

  for (const match of statement.matchAll(intro)) {
    let index = (match.index ?? 0) + match[0].length
    // FROM / JOIN 后面可以是逗号分隔的多张表
    for (;;) {
      const probe = skipSpaces(statement, index)

      // 派生表：(SELECT …) 别名
      if (statement[probe] === '(') {
        const bodyStart = skipSpaces(statement, probe + 1)
        if (!/^select\b/i.test(statement.slice(bodyStart, bodyStart + 7))) {
          break
        }
        const close = matchParen(statement, probe)
        if (close < 0) {
          break
        }
        const alias = readAlias(statement, skipSpaces(statement, close + 1))
        if (alias) {
          refs.push({
            schema: '',
            table: alias.alias,
            alias: alias.alias,
            virtualColumns:
              parseSelectOutputColumns(statement.slice(probe + 1, close)) ?? undefined,
          })
        }
        index = alias ? alias.end : close + 1

        const next = skipSpaces(statement, index)
        if (statement[next] === ',') {
          index = next + 1
          continue
        }
        break
      }

      const name = readQualifiedName(statement, index)
      if (!name) {
        break
      }
      const alias = readAlias(statement, name.end)
      refs.push(toTableRef(name.parts, alias?.alias ?? ''))
      index = alias?.end ?? name.end

      const next = skipSpaces(statement, index)
      if (statement[next] !== ',') {
        break
      }
      index = next + 1
    }
  }

  // CTE：名字 → 输出列。物理引用（FROM cte x）升级为虚拟表并补登记 CTE 名
  const ctes = collectCtes(statement)
  const named: TableRef[] = []
  for (const ref of refs) {
    if (!ref.schema && ctes.has(ref.table)) {
      ref.virtualColumns = ctes.get(ref.table) ?? undefined
      if (ref.alias && ref.alias.toLowerCase() !== ref.table.toLowerCase()) {
        named.push({ schema: '', table: ref.table, alias: '', virtualColumns: ref.virtualColumns })
      }
    }
  }
  refs.push(...named)
  for (const [name, columns] of ctes) {
    const exists = refs.some(ref =>
      ref.table.toLowerCase() === name.toLowerCase()
      || ref.alias.toLowerCase() === name.toLowerCase())
    if (!exists) {
      refs.push({ schema: '', table: name, alias: '', virtualColumns: columns ?? undefined })
    }
  }

  return refs
}

/** 限定名各段 → 表引用；三段及以上时取最后两段（库/模式 + 表） */
function toTableRef(parts: string[], alias: string): TableRef {
  const table = parts.length ? parts[parts.length - 1] : ''
  const schema = parts.length > 1 ? parts[parts.length - 2] : ''
  return { schema, table, alias }
}

// ------------------------------------------------- 派生表 / CTE 的输出列解析

/** 跳过引号包裹的字符串/标识符，返回结束引号之后的下标（未闭合则返回文本长度） */
function skipQuoted(text: string, start: number): number {
  const quote = text[start] ?? ''
  let i = start + 1
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2
      continue
    }
    if (text[i] === quote) {
      if (text[i + 1] === quote) {
        i += 2
        continue
      }
      return i + 1
    }
    i++
  }
  return text.length
}

/** 找到与 start 处 `(` 配对的 `)` 下标；找不到返回 -1 */
function matchParen(text: string, start: number): number {
  let depth = 0
  let i = start
  while (i < text.length) {
    const ch = text[i] ?? ''
    if (ch === `'` || ch === `"` || ch === '`') {
      i = skipQuoted(text, i)
      continue
    }
    if (ch === '(') {
      depth++
    }
    else if (ch === ')') {
      depth--
      if (depth === 0) {
        return i
      }
    }
    i++
  }
  return -1
}

/** 判断 [start, end) 之间的括号是否全部闭合（即 end 处于顶层） */
function isTopLevel(text: string, start: number, end: number): boolean {
  let depth = 0
  let i = start
  while (i < end) {
    const ch = text[i] ?? ''
    if (ch === `'` || ch === `"` || ch === '`') {
      i = skipQuoted(text, i)
      continue
    }
    if (ch === '(') {
      depth++
    }
    else if (ch === ')') {
      depth--
    }
    i++
  }
  return depth === 0
}

/** 从 start 起找第一个顶层（括号与字符串之外）的 FROM 关键字；没有返回 -1 */
function findTopLevelFrom(text: string, start: number): number {
  for (const match of text.slice(start).matchAll(/\bfrom\b/gi)) {
    const index = start + (match.index ?? 0)
    if (isTopLevel(text, start, index)) {
      return index
    }
  }
  return -1
}

/** 按顶层逗号切分（括号与字符串内的逗号不算） */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let last = 0
  let i = 0
  while (i < text.length) {
    const ch = text[i] ?? ''
    if (ch === `'` || ch === `"` || ch === '`') {
      i = skipQuoted(text, i)
      continue
    }
    if (ch === '(') {
      depth++
    }
    else if (ch === ')') {
      depth--
    }
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(last, i))
      last = i + 1
    }
    i++
  }
  parts.push(text.slice(last))
  return parts
}

/** 去掉标识符的包裹引号 */
function unquoteIdent(name: string): string {
  return name.replace(/^[`"[]/, '').replace(/[`"\]]$/, '')
}

/**
 * 解析语句里的 CTE 定义：WITH [RECURSIVE] name [(列, …)] AS (SELECT …), …
 * 返回 名字 → 输出列（列清单 / SELECT 输出解析不出时为 null）。
 */
function collectCtes(statement: string): Map<string, string[] | null> {
  const ctes = new Map<string, string[] | null>()

  for (const match of statement.matchAll(/\bwith\b/gi)) {
    let index = skipSpaces(statement, (match.index ?? 0) + match[0].length)
    if (/^recursive\b/i.test(statement.slice(index, index + 10))) {
      index = skipSpaces(statement, index + 9)
    }

    for (;;) {
      const name = readIdentifier(statement, index)
      if (!name || NON_ALIAS_KEYWORDS.has(name.name.toLowerCase())) {
        break
      }
      index = skipSpaces(statement, name.end)

      // 显式列清单：WITH n(a, b) AS (…)
      let columns: string[] | null = null
      if (statement[index] === '(') {
        const close = matchParen(statement, index)
        if (close < 0) {
          break
        }
        columns = splitTopLevel(statement.slice(index + 1, close))
          .map(part => unquoteIdent(part.trim()))
          .filter(Boolean)
        index = skipSpaces(statement, close + 1)
      }

      if (!/^as\b/i.test(statement.slice(index, index + 3))) {
        break
      }
      index = skipSpaces(statement, index + 2)
      if (statement[index] !== '(') {
        break
      }
      const close = matchParen(statement, index)
      if (close < 0) {
        break
      }
      ctes.set(name.name, columns ?? parseSelectOutputColumns(statement.slice(index + 1, close)))
      index = skipSpaces(statement, close + 1)

      if (statement[index] === ',') {
        index = skipSpaces(statement, index + 1)
        continue
      }
      break
    }

    if (ctes.size) {
      break // 只认第一处能解析出 CTE 的 WITH
    }
  }

  return ctes
}

/**
 * 解析一段 SELECT 的输出列名（用于派生表 / CTE）。
 * 只接受可静态确定的名字：`expr AS 别名`、`t.col`、别名跟随、裸列名。
 * 含 `*` / `t.*` / 无法命名的表达式（如不带别名的 `COUNT(*)`）时返回 null，
 * 调用方按「列未知」处理。
 */
function parseSelectOutputColumns(selectText: string): string[] | null {
  const selectMatch = /\bselect\b/i.exec(selectText)
  if (!selectMatch) {
    return null
  }

  const listStart = selectMatch.index + selectMatch[0].length
  const listEnd = findTopLevelFrom(selectText, listStart)
  const rawList = selectText.slice(listStart, listEnd < 0 ? selectText.length : listEnd).trim()
  const distinct = /^(distinct|all)\b/i.exec(rawList)
  const list = (distinct ? rawList.slice(distinct[0].length) : rawList).trim()
  if (!list) {
    return null
  }

  const columns: string[] = []
  for (const item of splitTopLevel(list)) {
    const name = readOutputName(item.trim())
    if (!name) {
      return null
    }
    columns.push(name)
  }
  return columns
}

/**
 * 读取 SELECT 输出项的列名；无法静态确定时返回 null。
 * 支持 `expr AS 别名`、`t.col`（取最后一段）、`表达式 别名`（别名跟随）、裸列名。
 */
function readOutputName(item: string): string | null {
  const asMatch = /\bas\s+(`[^`]*`|"[^"]*"|\[[^\]]*\]|[A-Za-z_$][\w$]*)\s*$/i.exec(item)
  if (asMatch) {
    return unquoteIdent(asMatch[1])
  }

  const tail = /(`[^`]*`|"[^"]*"|\[[^\]]*\]|[A-Za-z_$][\w$]*)\s*$/.exec(item)
  if (!tail) {
    return null
  }
  const token = tail[1]
  const before = item.slice(0, tail.index).trimEnd()

  // t.col / db.t.col：最后一段就是列名
  if (before.endsWith('.')) {
    return unquoteIdent(token)
  }

  // 整项就是一列（可能带引号）
  if (!before) {
    return unquoteIdent(token)
  }

  // 别名跟随：要求前一个非空白字符是标识符/右括号/引号，
  // 排除 `a + b` 这类以运算符收尾的表达式；`CASE … END` 等关键字不算
  const prevChar = before.slice(-1)
  if (
    /\s$/.test(item.slice(0, tail.index))
    && /[\w$)\]`"]/.test(prevChar)
    && !NON_ALIAS_KEYWORDS.has(token.toLowerCase())
  ) {
    return unquoteIdent(token)
  }

  return null
}

/** 常用关键字（补全顺序按数组顺序） */
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
  'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'ON', 'AS', 'AND', 'OR',
  'NOT', 'NULL', 'IN', 'BETWEEN', 'LIKE', 'IS NULL', 'DISTINCT', 'INSERT INTO',
  'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'DROP TABLE',
  'ALTER TABLE', 'TRUNCATE TABLE', 'CREATE INDEX', 'DROP INDEX',
  'UNION ALL', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'ASC', 'DESC', 'SHOW TABLES', 'DESCRIBE', 'EXPLAIN', 'USE',
]

/** 常用函数（label → 提示的签名说明） */
const SQL_FUNCTIONS: Record<string, string> = {
  COUNT: '统计行数',
  SUM: '求和',
  AVG: '平均',
  MIN: '最小值',
  MAX: '最大值',
  IFNULL: 'IFNULL(值, 默认值)',
  COALESCE: '返回第一个非空值',
  NOW: '当前时间',
  DATE_FORMAT: 'DATE_FORMAT(日期, 格式)',
  STR_TO_DATE: 'STR_TO_DATE(文本, 格式)',
  CONCAT: '字符串拼接',
  SUBSTRING: 'SUBSTRING(文本, 起点, 长度)',
  LENGTH: '字节长度',
  TRIM: '去首尾空白',
  UPPER: '转大写',
  LOWER: '转小写',
  ROUND: '四舍五入',
  FLOOR: '向下取整',
  CEIL: '向上取整',
  UNIX_TIMESTAMP: 'Unix 时间戳',
  FROM_UNIXTIME: '时间戳转日期',
  DATE_ADD: 'DATE_ADD(日期, INTERVAL n 单位)',
  DATE_SUB: 'DATE_SUB(日期, INTERVAL n 单位)',
  DATEDIFF: '日期差（天）',
  GROUP_CONCAT: '分组拼接',
}
