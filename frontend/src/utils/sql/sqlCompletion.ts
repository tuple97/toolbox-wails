/**
 * 分层智能补全（CodeMirror 6）：按编辑器用途分派到 SQL / 模板 / 脚本三条路径。
 *
 * ## 补全模式（completionMode，由编辑器用途决定，不靠 language 猜）
 *
 *  | 模式 | 使用位置 | 候选来源 |
 *  |---|---|---|
 *  | `sql` | 命令执行器 | 元数据表/列/库 + SQL 关键字 + 函数 |
 *  | `sql-template` | SQL 模板编辑器 | `sql` 全部 + `{{ 变量 }}` + 模板函数 |
 *  | `javascript` | 前置 / 后置脚本 | 注入的全局标识符（语言自带源由编辑器追加） |
 *  | `none` | 执行日志 | 不补全 |
 *
 * ## 分派顺序（不可颠倒）
 *
 *  1. `none` → 直接返回 null；
 *  2. `javascript` → 只给注入的全局标识符（自身会跳过字符串 / 注释）；
 *  3. `sql-template` → 光标前 30 字符内检测未闭合的 `{{ … }}`，命中走模板候选。
 *     这一步必须**先于**字符串 / 注释判断：`'{{ device_no }}'` 这种引号内插值
 *     是最常见的写法，否则模板补全永远不出现；
 *  4. `inLiteralOrComment`（复用 sqlSyntax，语法树判定）→ 字符串 / 注释里返回 null；
 *  5. 其余落到 SQL 逻辑。
 *
 * ## SQL 逻辑要点
 *
 *  - **按位置给候选**（`readClauseKind` 反向扫描出最近的同级子句关键字）：
 *    `FROM |` → 只给表与库；`FROM t |` → 表 + 库 + 关键字；`SELECT |` → 列 + 别名 + 函数。
 *    子句判定用容错扫描而不是语法树：补全时语句往往没写完，扫描比半成品语法树稳。
 *  - **作用域按子查询分层**：靠 `sqlSyntax.scopeRanges` 拿到嵌套括号节点，
 *    「最内层子查询 → … → 外层语句」逐层解析表引用；内层别名遮蔽外层同名别名，
 *    支持相关子查询（内层可用外层表的字段）。
 *  - **CTE 沿作用域链广播**：CTE 只定义在某一层，但内层子查询也能引用它，
 *    因此从内到外合并出一份可见 CTE，再回填到各层的表引用上；同名时内层优先；
 *    光标落在某 CTE 定义体内时把它剔除，避免递归 CTE 自引用误补。
 *  - **依赖链**：`WITH a AS (…), b AS (SELECT * FROM a)` 按声明顺序解析，
 *    `b` 里的 `*` 会用 `a` 的输出列展开；解析不出时按「列未知」处理（不猜）。
 *  - 点号补全按「逐层别名 > 逐层无别名 CTE 名 > 显式 `库.表.` > 当前库表名 > 库名」解析。
 *  - 元数据统一由 `stores/metadataStore.ts` 缓存（TTL 5 分钟），缺失时后台异步补齐，
 *    本次补全立即返回已有数据，绝不阻塞输入；测试可用 `MetadataProvider` 注入假数据。
 *  - 别名 / 派生表 / CTE 这些**语义**用容错扫描（`collectTableRefs`）而不是语法树：
 *    补全时语句通常还没写完（正打到 `where u.`），语法树没有别名语义，
 *    而这套扫描对半成品语句更宽容。
 */
import { startCompletion } from '@codemirror/autocomplete'
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { useMetadataStore } from '@/stores/metadataStore'
import { splitSqlStatements } from '@/utils/sql/sqlStatementRanges'
import { inLiteralOrComment, scopeRanges } from '@/utils/sql/sqlSyntax'
import type { TextRange } from '@/utils/sql/sqlSyntax'
import { dialectOf, quoteIdent } from '@/utils/sql/rowSql'
import type { SqlDialect } from '@/utils/sql/rowSql'
import type { ExecutorColumn } from '@/types'
import {
  BOOST_ALIAS,
  BOOST_CLAUSE_KEYWORD,
  BOOST_EXPRESSION_KEYWORD,
  BOOST_FUNCTION,
  BOOST_NAMESPACE,
  BOOST_TABLE,
  CLAUSE_KEYWORDS,
  EXPRESSION_KEYWORDS,
  JOIN_KEYWORDS,
  SQL_FUNCTIONS,
  SQL_KEYWORDS,
} from './sqlCompletionKeywords'
import { clearColumnMarks, columnItem, qualifierBeforeCursor } from './sqlCompletionInsert'
import { readTemplateContext, scriptBundle, templateBundle } from './sqlTemplateCompletion'
import type { ColumnCompletion } from './sqlCompletionInsert'

// 拆分模块的对外 API 在此统一再导出：调用方（组件 / 测试）仍从 '@/utils/sql/sqlCompletion' 导入
export { columnHoverAt } from './sqlCompletionHover'
export type { SqlColumnInfo, SqlColumnHover } from './sqlCompletionHover'
export {
  clearColumnMarks,
  columnsMarked,
  isColumnMarked,
  toggleColumnMark,
  qualifierBeforeCursor,
  type ColumnCompletion,
  type ColumnDetail,
} from './sqlCompletionInsert'

/** 补全模式：由编辑器用途决定 */
export type CompletionMode = 'sql' | 'sql-template' | 'javascript' | 'none'

/** SQL 侧上下文：连接 / 生效库 / 方言（getter 由编辑器登记，切换连接自动生效） */
export interface SqlContext {
  connId: number
  database: string
  dbType: string
}

/** 模板变量（来自模板的 VariableConfig[]） */
export interface TemplateVariable {
  /** 变量名，与模板中 {{ 名字 }} 一致 */
  name: string
  /** 展示名（有则作为 detail 提示） */
  label?: string
}

/** 元数据提供者：默认走 metadataStore，测试可注入静态数据 */
export interface MetadataProvider {
  databases(connId: number): string[]
  tables(connId: number, database: string): string[]
  columns(connId: number, database: string, table: string): ExecutorColumn[]
}

/** 一次补全所需的运行期上下文 */
export interface CompletionRuntime {
  mode: CompletionMode
  /** SQL 侧上下文；未登记（如模板编辑器未绑定连接）时退化为关键字 + 函数 */
  sql?: SqlContext
  /** 模板变量（sql-template 模式） */
  templateVariables?: TemplateVariable[]
  /** 脚本注入的全局标识符（javascript 模式） */
  scriptGlobals?: string[]
  /** 元数据来源；缺省用 metadataStore */
  metadata?: MetadataProvider
}

/** 补全结果（内部统一形态，供补全源与测试共用） */
export interface CompletionBundle {
  from: number
  options: Completion[]
}

/** 单个编辑器登记的上下文（按需扩展，避免替换原来的 getter 机制） */
interface CompletionRegistration {
  getSql?: () => SqlContext
  getTemplateVariables?: () => TemplateVariable[]
  getScriptGlobals?: () => string[]
}

/**
 * 编辑器实例 → 补全上下文。
 *
 * 键必须是 EditorView 而不是 EditorState：CM6 里任何 dispatch（含 Compartment
 * 重配置主题）都会产生新的 EditorState，用 state 做键会在切换主题后丢上下文。
 */
const viewContexts = new WeakMap<EditorView, CompletionRegistration>()

/** 取（或初始化）某个编辑器的登记项 */
function registrationOf(view: EditorView): CompletionRegistration {
  let item = viewContexts.get(view)
  if (!item) {
    item = {}
    viewContexts.set(view, item)
  }
  return item
}

/** 为某个编辑器登记 SQL 上下文（命令执行器挂载时调用） */
export function registerCompletionContext(view: EditorView, getContext: () => SqlContext) {
  registrationOf(view).getSql = getContext
}

/** 为某个编辑器登记模板变量（SQL 模板编辑器挂载时调用） */
export function registerTemplateContext(view: EditorView, getVariables: () => TemplateVariable[]) {
  registrationOf(view).getTemplateVariables = getVariables
}

/** 为某个编辑器登记脚本可用的全局标识符（脚本编辑器挂载时调用） */
export function registerScriptGlobals(view: EditorView, getGlobals: () => string[]) {
  registrationOf(view).getScriptGlobals = getGlobals
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
 */
export function createSqlCompletion(
  getView: () => EditorView | null,
  mode: CompletionMode = 'sql',
  metadata: MetadataProvider = defaultMetadataProvider,
): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    if (mode === 'none') {
      return null
    }
    const view = getView()
    if (!view) {
      return null
    }
    // 每次重新查询都重置勾选（勾选只属于这一次筛选）
    clearColumnMarks(view)

    const registration = viewContexts.get(view) ?? {}
    const bundle = collectCompletions(context.state, context.pos, {
      mode,
      sql: registration.getSql?.(),
      templateVariables: registration.getTemplateVariables?.() ?? [],
      scriptGlobals: registration.getScriptGlobals?.() ?? [],
      metadata,
    })

    if (!bundle || !bundle.options.length) {
      // 返回 null 让已打开的补全弹层正常关闭（列未知时不报错）
      return null
    }

    return {
      from: bundle.from,
      options: bundle.options,
      // 继续输入标识符时在本地过滤，避免每次都重新查询元数据
      validFor: /^[\w$]*$/,
    }
  }
}

/**
 * 按模式产出候选（补全源与测试共用）。
 * 只依赖 EditorState，不依赖 EditorView / DOM，因此可以在单测里直接调用。
 */
export function collectCompletions(
  state: EditorState,
  pos: number,
  runtime: CompletionRuntime,
): CompletionBundle | null {
  if (runtime.mode === 'none') {
    return null
  }

  // JavaScript：只给注入的全局标识符（关键字/片段由 lang-javascript 自带源负责）
  if (runtime.mode === 'javascript') {
    return scriptBundle(state, pos, runtime.scriptGlobals ?? [])
  }

  /*
   * 模板上下文要**先于**字符串判断：模板里 `'{{ device_no }}'`（引号内插值）
   * 是最常见的写法，若先被 inLiteralOrComment 拦掉，模板补全就永远不出现。
   * 这里的顺序调整只影响「确实处于 {{ … }} 内」的情形，
   * 字符串／注释里的其它位置依旧不弹候选。
   */
  if (runtime.mode === 'sql-template') {
    const template = readTemplateContext(state, pos)
    if (template) {
      return templateBundle(template, runtime.templateVariables ?? [])
    }
  }

  /*
   * 字符串 / 注释里不弹补全（语法树判定，见 inLiteralOrComment）：
   * 否则在 `-- 写点什么` 或 `'abc'` 里打字会一直冒表名与列名。
   */
  if (inLiteralOrComment(state, pos)) {
    return null
  }

  return sqlBundle(state, pos, runtime)
}

// ---------------------------------------------------------------- 静态补全

/** 无连接上下文时的静态补全：SQL 关键字 + 常用函数 */
function staticOptions(): Completion[] {
  return [
    ...SQL_KEYWORDS.map(label => ({ label, type: 'keyword' as const })),
    ...Object.entries(SQL_FUNCTIONS).map(([label, detail]) => ({
      label,
      type: 'function' as const,
      detail,
      apply: `${label}()`,
    })),
  ]
}

// ---------------------------------------------------------------- SQL 路径

/** SQL 逻辑：解析作用域 → 点号 / 子句上下文 → 候选 */
function sqlBundle(
  state: EditorState,
  pos: number,
  runtime: CompletionRuntime,
): CompletionBundle | null {
  const metadata = runtime.metadata ?? defaultMetadataProvider
  const doc = state.doc.toString()
  const line = state.doc.lineAt(pos)
  const lineBefore = line.text.slice(0, pos - line.from)

  // 光标前正在输入的标识符片段（点号补全时通常为空）
  const word = /[A-Za-z0-9_$]*$/.exec(lineBefore)?.[0] ?? ''
  const from = pos - word.length

  // 没有登记连接上下文（模板编辑器未绑定连接）：退化为关键字 + 函数
  if (!runtime.sql || !runtime.sql.connId) {
    return { from, options: staticOptions() }
  }

  const { connId, database, dbType } = runtime.sql
  const dialect = dialectOf(dbType)

  /*
   * 作用域链（由内到外）：内层子查询 → 外层语句。整段脚本里其它语句的别名
   * 不会出现在链上，所以不会互相污染；子查询里则能同时看到内外两层的表。
   */
  // 补全口径的语句范围：只算一次，作用域解析与子句判定共用
  const statement = completionStatementRange(doc, pos, dbType)

  const scopes = buildScopes(state, pos, doc, dbType, statement, connId, database, metadata)

  const qualifier = readQualifierBeforeCursor(lineBefore)
  const options = qualifier
    ? resolveAfterDot(qualifier, scopes, connId, database, dialect, metadata)
    : generalSuggestions(
        scopes,
        connId,
        database,
        dialect,
        readClauseKind(currentClausePrefix(doc, pos, statement)),
        metadata,
      )

  return { from, options }
}

// ---------------------------------------------------------------- 悬停提示
//
// 列悬停的实现（columnHoverAt 等）拆到了 ./sqlCompletionHover.ts，
// 与补全共用本文件的 buildScopes / completionStatementRange。
// 这里只保留登记上下文的读取入口（悬停与补成都要用）。

/** 读某个编辑器登记的 SQL 上下文（未登记返回 null） */
export function sqlContextOf(view: EditorView | null): SqlContext | null {
  return (view && viewContexts.get(view)?.getSql?.()) ?? null
}

/**
 * 构建作用域链（内 → 外）：每层解析表引用，并把 CTE 定义沿链广播。
 *
 * 为什么需要广播：CTE 通常写在外层语句，但内层子查询同样能引用它；
 * 单看某一层的文本是解析不出这些列的。
 *
 *  - 同名 CTE 内层优先（内层遮蔽外层）；
 *  - 光标落在某个 CTE 定义体内时剔除该 CTE，否则递归 CTE
 *    （`WITH RECURSIVE t AS (… FROM t)`）会拿到自己而误补；
 *  - 派生表里的 `SELECT *`（如 `(SELECT * FROM users) t1`）用元数据展开，
 *    否则 `t1.` 会因为「列未知」而没有任何候选；
 *  - 光标位于「定义体」（CTE 定义体，或 FROM / JOIN 后面的派生表体）时只保留这一层：
 *    定义体求值先于同一 FROM 里的其它表，标准 SQL 不允许引用它们（那要写 LATERAL），
 *    否则 `FROM (SELECT | FROM users) t1` 会在内层冒出外层别名 t1。
 */
export function buildScopes(
  state: EditorState,
  pos: number,
  doc: string,
  dbType: string,
  statement: TextRange | null,
  connId: number,
  database: string,
  metadata: MetadataProvider,
): TableRef[][] {
  /** 原始作用域链（内 → 外），是否被下面的定义体规则截断见后文 */
  const allScopes = scopeRanges(state, pos, doc, dbType, statement)
    .map(range => ({ range, text: doc.slice(range.from, range.to) }))

  /**
   * `SELECT *` 的物理表来源：查元数据缓存（缺失时由 provider 后台补齐，
   * 本次解析先按「列未知」处理，绝不阻塞输入）。
   *
   * 结果里带上 from / dataType，派生列在候选列表中就能显示来源表与字段类型。
   */
  const resolveStarColumns = (ref: TableRef): VirtualColumn[] | null => {
    const columns = metadata.columns(connId, ref.schema || database, ref.table)
      .map(column => ({
        name: column.name,
        from: ref.table,
        dataType: column.dataType,
        comment: column.comment,
      }))
    return columns.length ? columns : null
  }

  /** 某张表某列的类型 / 注释：给「显式列清单」的派生列补出来源信息 */
  const resolveColumnMeta = (ref: TableRef, column: string) => {
    const found = metadata.columns(connId, ref.schema || database, ref.table)
      .find(item => item.name.toLowerCase() === column.toLowerCase())
    return found ? { dataType: found.dataType, comment: found.comment } : null
  }

  // 1) 从内到外收集 CTE（内层同名先注册，外层不覆盖）
  const visibleCtes = new Map<string, VirtualColumn[] | null>()
  /** 光标所在定义体的 CTE：对本次补全不可见（递归自引用） */
  const hiddenCtes = new Set<string>()
  /** 光标是否落在某个 CTE 定义体内 */
  let insideCteBody = false

  /** 跨层可见的 CTE 输出列（内层子查询能引用外层定义的 CTE） */
  const resolveCteColumns = (name: string): VirtualColumn[] | null =>
    visibleCtes.get(name.toLowerCase()) ?? null

  for (const scope of allScopes) {
    const defs = collectCteDefs(
      scope.text,
      scope.range.from,
      name => visibleCtes.get(name) ?? null,
      { resolveStarColumns, resolveColumnMeta, resolveCteColumns },
    )
    for (const def of defs) {
      const key = def.name.toLowerCase()
      // 光标在定义体内：不注册，避免自引用
      if (pos >= def.bodyFrom && pos <= def.bodyTo) {
        hiddenCtes.add(key)
        insideCteBody = true
        continue
      }
      if (visibleCtes.has(key)) {
        continue
      }
      visibleCtes.set(key, def.columns)
    }
  }

  /*
   * 光标在定义体里时截断到最内层：定义体（CTE 的 AS (…)、FROM/JOIN 后的派生表）
   * 在求值时先于同一 FROM 里的其它表，引用它们属于非法 SQL（LATERAL 例外，暂不支持），
   * 因此更外层不贡献任何表引用。
   */
  const inDefinitionBody = insideCteBody
    || (allScopes.length > 1 && isDerivedTableBody(doc, allScopes[0].range))
  const scopes = inDefinitionBody ? allScopes.slice(0, 1) : allScopes

  // 2) 每层解析表引用，并用可见 CTE 回填派生列
  //
  // `*` 的展开来源在这一步额外叠加「可见 CTE」：`FROM (SELECT * FROM a) t`
  // 里的 `a` 若是 CTE，静态解析同样要拿到它的输出列（收集 CTE 那一轮只有元数据可用）。
  const resolveStarWithCtes = (ref: TableRef): VirtualColumn[] | null =>
    visibleCtes.get(ref.table.toLowerCase()) ?? resolveStarColumns(ref)

  return scopes.map((scope) => {
    const refs = collectTableRefs(scope.text, {
      excludeCte: name => hiddenCtes.has(name),
      resolveStarColumns: resolveStarWithCtes,
      resolveColumnMeta,
      resolveCteColumns,
    })
    for (const ref of refs) {
      if (ref.virtualColumns) {
        continue
      }
      const columns = visibleCtes.get(ref.table.toLowerCase())
      if (columns) {
        ref.virtualColumns = columns
      }
    }
    return refs
  })
}

/**
 * 括号范围是不是「派生表体」：`FROM (…)` / `JOIN (…)` 里的子查询。
 *
 * 只看括号左侧的关键字（范围两端都不含括号本身），
 * 于是 `WHERE EXISTS (…)`、`IN (…)` 这类表达式位置的子查询会返回 false。
 */
function isDerivedTableBody(doc: string, range: TextRange): boolean {
  if (doc[range.from - 1] !== '(') {
    return false
  }

  let index = range.from - 2
  while (index >= 0 && /\s/.test(doc[index] ?? '')) {
    index--
  }
  const end = index + 1
  while (index >= 0 && /[\w$]/.test(doc[index] ?? '')) {
    index--
  }
  const word = doc.slice(index + 1, end).toLowerCase()
  return word === 'from' || word === 'join' || word === 'into' || word === 'update'
}

// ---------------------------------------------------------------- 模板 / 脚本路径
//
// 模板（{{ … }}）与 JavaScript 两种模式的补全拆到了 ./sqlTemplateCompletion.ts，
// collectCompletions 按光标是否在未闭合的 {{ … }} 内分派。

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
  metadata: MetadataProvider,
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
      return columnSuggestions(connId, matchedRef.schema || database, matchedRef.table, metadata)
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
    return columnSuggestions(connId, schema, last, metadata)
  }

  // 4) 当前库里的表名
  if (metadata.tables(connId, database).some(name => name.toLowerCase() === qualifier)) {
    return columnSuggestions(connId, database, last, metadata)
  }

  // 5) 库名 → 该库的表
  if (metadata.databases(connId).some(name => name.toLowerCase() === qualifier)) {
    return tableSuggestions(connId, last, dialect, metadata)
  }

  // 6) 兜底：按当前库的表取字段（顺带预热缓存）
  return columnSuggestions(connId, database, last, metadata)
}

// ColumnDetail / ColumnCompletion / columnItem 见 ./sqlCompletionInsert.ts

/** 字段补全项（某张表的列） */
function columnSuggestions(
  connId: number,
  database: string,
  table: string,
  metadata: MetadataProvider,
): Completion[] {
  return metadata.columns(connId, database, table).map(column => columnItem(column.name, {
    dataType: column.dataType,
    from: table,
    comment: column.comment,
  }))
}

/** 派生表 / CTE 的字段补全（列名与类型来自静态解析 + 元数据） */
function virtualColumnSuggestions(columns: VirtualColumn[], source: string): Completion[] {
  return columns.map(column => columnItem(column.name, {
    dataType: column.dataType,
    from: column.from ?? source,
    comment: column.comment,
  }))
}

/** 派生表 / CTE 别名候选的提示：所有列来源一致时点出源头表 */
function derivedSourceDetail(columns: VirtualColumn[]): string {
  const sources = [...new Set(columns.map(column => column.from).filter(Boolean))]
  const from = sources.length === 1 ? ` · ${sources[0]}` : ''
  return `派生表${from}（${columns.length} 列）`
}

/** 表补全项 */
function tableSuggestions(
  connId: number,
  database: string,
  dialect: SqlDialect,
  metadata: MetadataProvider,
): Completion[] {
  return metadata.tables(connId, database).map(table => ({
    label: table,
    type: 'class',
    detail: '表 / 视图',
    boost: BOOST_TABLE,
    apply: quoteIdent(table, dialect),
  }))
}

// ---------------------------------------------------------------- 普通补全

/**
 * 位置 → 关键字集合。
 *
 * | 位置          | 给什么                                                 |
 * | ------------- | ------------------------------------------------------ |
 * | `any`         | 全量（含 DDL）—— 新语句开头本来就要写这些               |
 * | `afterSource` | `AS` + 连接 + 子句，不给表达式关键字与 DDL              |
 * | `column`      | 表达式优先，其次连接 / 子句（写完条件接着写 WHERE 等）  |
 * | `source`      | 无 —— 表名位置只给表与库                               |
 * | `alias`       | 无 —— `AS` 之后只能写别名                              |
 */
function keywordsFor(kind: ClauseKind): string[] {
  switch (kind) {
    case 'any':
      return SQL_KEYWORDS
    case 'afterSource':
      return ['AS', ...JOIN_KEYWORDS, ...CLAUSE_KEYWORDS]
    case 'column':
      return [...EXPRESSION_KEYWORDS, ...JOIN_KEYWORDS, ...CLAUSE_KEYWORDS]
    default:
      return []
  }
}

/** 关键字权重：表达式关键字排在子句关键字之前 */
function keywordBoost(keyword: string): number {
  return EXPRESSION_KEYWORD_SET.has(keyword) ? BOOST_EXPRESSION_KEYWORD : BOOST_CLAUSE_KEYWORD
}

/** 表达式关键字的集合版，用于决定候选权重 */
const EXPRESSION_KEYWORD_SET = new Set(EXPRESSION_KEYWORDS)

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
 * 补全所处位置的候选类型。
 *
 *  - `source`：**表名还没写**（`FROM |`、`JOIN |`、`INTO |`、`FROM t, |`）→ 只给表与库；
 *  - `afterSource`：表来源已写（`FROM t |`、`AS t1 |`）→ 表 + 库 + 连接 / 子句关键字；
 *  - `column`：表达式位置（SELECT / WHERE / ON / SET / BY / 函数参数…）
 *    → 列 + 别名 + 函数 + 关键字；
 *  - `alias`：别名位置（`… AS |`）→ **什么也不给**：这里只能写别名，
 *    列名、函数、关键字全是噪音；
 *  - `any`：判断不出（语句开头、空行）→ 表 + 库 + 全量关键字（含 DDL）。
 */
type ClauseKind = 'source' | 'afterSource' | 'column' | 'alias' | 'any'

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
        /*
         * `AS` 之后就是别名本身（表别名 / 列别名）：
         * 光标还在 `AS |` 时不该弹任何候选；
         * 别名已经写完（`AS t1 |`）则回到「表之后」，接下来是 JOIN / WHERE 这些子句关键字。
         */
        if (lower === 'as') {
          return prefix.slice(index).trim() ? 'afterSource' : 'alias'
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
 * 用补全口径的语句范围（`completionStatementRange`）：
 * 光标停在语句末尾空白或新起一行时也算这条语句，否则会从头把
 * **上一条语句**的子句当成上下文（在 FROM 后面之后接着弹列名）。
 */
function currentClausePrefix(doc: string, pos: number, statement: TextRange | null): string {
  const start = statement ? statement.from : doc.lastIndexOf(';', pos - 1) + 1
  return doc.slice(Math.max(0, start), pos)
}

/**
 * 补全口径的语句范围：光标所在的**那一条**语句，取不到返回 null。
 *
 * 与 `statementAtCursor`（执行 / 画边框用）的区别：那边要求光标确实"落在"语句里，
 * 空行与语句末尾之后的换行都算不归属；而补全几乎总在"正在写"的位置——
 * 光标停在 `… WHERE ` 之后、或新起一行准备继续写时，必须仍能看到这张表的列，
 * 所以这里把「语句末尾之后、下一条语句之前的空白」也算作该语句。
 */
export function completionStatementRange(doc: string, pos: number, dbType = ''): TextRange | null {
  const statements = splitSqlStatements(doc, dbType)

  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index]
    if (pos >= statement.from && pos <= statement.to) {
      return { from: statement.from, to: statement.to }
    }

    const next = statements[index + 1]
    const beforeNext = !next || pos < next.from
    if (pos > statement.to && beforeNext && doc.slice(statement.to, pos).trim() === '') {
      return { from: statement.from, to: statement.to }
    }
  }

  return null
}

/**
 * 非点号场景（Ctrl+Space / 输入中）按位置给候选：
 *  - `source`：**只给表与库**——表名还没写，这时冒 JOIN / WHERE 之类的关键字纯属干扰；
 *  - `afterSource`：表 + 库 + `AS` / JOIN / WHERE 等关键字；
 *  - `column`：列 → 别名 → 函数 → 关键字（表达式关键字在前，子句关键字在后）；
 *  - `alias`：**什么都不给**——`AS` 之后只能写别名；
 *  - `any`：表 + 库 + 全量关键字（含 DDL）。
 *
 * `scopes` 由内到外排列，列与别名都按**分层遮蔽**收集：
 *  - `seenAliases`：内层出现同名来源（别名或表名）后，外层同名来源不再贡献列；
 *  - `seenColumns`：只做最终列名去重（不同来源的同名列只出一次）。
 */
function generalSuggestions(
  scopes: TableRef[][],
  connId: number,
  database: string,
  dialect: SqlDialect,
  kind: ClauseKind,
  metadata: MetadataProvider,
): Completion[] {
  const suggestions: Completion[] = []

  // 别名位置（`AS |`）：这里只能写别名，列名 / 表 / 关键字全是噪音
  if (kind === 'alias') {
    return suggestions
  }

  if (kind === 'column') {
    const seenAliases = new Set<string>()
    const seenColumns = new Set<string>()
    const aliasSuggestions: Completion[] = []

    for (const refs of scopes) {
      for (const ref of refs) {
        const source = ref.alias || ref.table
        const sourceKey = source.toLowerCase()
        // 内层已出现同名来源：外层同名的不再贡献列（作用域遮蔽）
        if (seenAliases.has(sourceKey)) {
          continue
        }
        seenAliases.add(sourceKey)

        if (ref.virtualColumns) {
          for (const column of ref.virtualColumns) {
            const key = column.name.toLowerCase()
            if (seenColumns.has(key)) {
              continue
            }
            seenColumns.add(key)
            suggestions.push(columnItem(column.name, {
              dataType: column.dataType,
              from: column.from ?? source,
              comment: column.comment,
            }))
          }
        }
        else {
          for (const column of metadata.columns(connId, ref.schema || database, ref.table)) {
            const key = column.name.toLowerCase()
            if (seenColumns.has(key)) {
              continue
            }
            seenColumns.add(key)
            suggestions.push(columnItem(column.name, {
              dataType: column.dataType,
              from: ref.table,
              comment: column.comment,
            }))
          }
        }

        // 语句里已定义的别名 / 无别名的 CTE：选它自动补上点号并继续弹字段
        const name = ref.alias || (ref.virtualColumns ? ref.table : '')
        if (!name) {
          continue
        }
        aliasSuggestions.push({
          label: name,
          type: 'variable',
          boost: BOOST_ALIAS,
          detail: ref.virtualColumns
            ? derivedSourceDetail(ref.virtualColumns)
            : ref.schema
              ? `别名 → ${ref.schema}.${ref.table}`
              : `别名 → ${ref.table}`,
          apply: applyAndTrigger(`${name}.`),
        })
      }
    }

    suggestions.push(...aliasSuggestions)
  }

  if (kind !== 'column') {
    suggestions.push(...tableSuggestions(connId, database, dialect, metadata))
    suggestions.push(...namespaceSuggestions(connId, dialect, metadata))
  }

  // 表名还没写：只给表与库，别让关键字把表名候选挤下去
  if (kind === 'source') {
    return suggestions
  }

  // 关键字按位置过滤：只给该位置写得出来的那些（矩阵见 keywordsFor）
  for (const keyword of keywordsFor(kind)) {
    suggestions.push({
      label: keyword,
      type: 'keyword',
      boost: keywordBoost(keyword),
    })
  }

  // 函数只在表达式位置给：表名、表之后、别名位置都用不到
  if (kind === 'column') {
    for (const [name, signature] of Object.entries(SQL_FUNCTIONS)) {
      suggestions.push({
        label: name,
        type: 'function',
        detail: signature,
        boost: BOOST_FUNCTION,
        apply: `${name}()`,
      })
    }
  }

  return suggestions
}

/** 库名候选：选中后自动补点号并再弹一次（接着就能选该库的表） */
function namespaceSuggestions(
  connId: number,
  dialect: SqlDialect,
  metadata: MetadataProvider,
): Completion[] {
  return metadata.databases(connId).map(name => ({
    label: name,
    type: 'namespace',
    detail: '数据库',
    boost: BOOST_NAMESPACE,
    apply: applyAndTrigger(`${quoteIdent(name, dialect)}.`),
  }))
}

// ---------------------------------------------------------------- 元数据（统一走 metadataStore）

/**
 * 默认元数据来源：`stores/metadataStore.ts`（与连接管理页共用同一份缓存，
 * 那边刷新后这里立刻用到新数据）。
 *
 * 三个方法都保持「同步返回缓存 + 后台补齐」的语义：补全候选必须立刻返回，
 * 绝不等待网络。测试可通过 `MetadataProvider` 注入静态数据替换它。
 */
export const defaultMetadataProvider: MetadataProvider = {
  databases: connId => metadata().ensureDatabases(connId),
  tables: (connId, database) => metadata().ensureTables(connId, database),
  columns: (connId, database, table) => metadata().ensureColumns(connId, database, table),
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

/**
 * 派生表 / CTE 的静态输出列。
 *
 * 除了名字，尽量带上来源表与类型：这类列以前在候选里只能显示「派生列」，
 * 看不出它到底来自哪张表、什么类型。
 */
interface VirtualColumn {
  name: string
  /** 来源表名（物理表 / 上游派生表 / CTE）；静态推不出来时为空 */
  from?: string
  /** 字段类型（来自元数据）；未知为空 */
  dataType?: string
  /** 字段注释（来自元数据） */
  comment?: string
}

/** 表引用：库/模式名（空表示未限定）、表名、别名（空表示无别名） */
export interface TableRef {
  schema: string
  table: string
  alias: string
  /** 派生表 / CTE 静态解析出的输出列；物理表为 undefined，走元数据查询 */
  virtualColumns?: VirtualColumn[]
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

/** 表引用解析的可选依赖（由调用方按当前连接提供） */
interface TableRefOptions {
  /** 光标所在定义体的 CTE：不作为可见来源（递归自引用） */
  excludeCte?: (name: string) => boolean
  /**
   * 查询物理表的列，用于展开派生表 / CTE 里的 `SELECT *`。
   * 实现方应「同步返回缓存 + 后台补齐」，绝不阻塞输入。
   */
  resolveStarColumns?: (ref: TableRef) => VirtualColumn[] | null
  /**
   * 查询某张表某列的类型 / 注释，用于给派生列附上来源信息。
   * 同样必须同步返回（查不到就返回 null）。
   */
  resolveColumnMeta?: (ref: TableRef, column: string) => { dataType: string, comment: string } | null
  /** 查询 CTE 的输出列（跨层可见的 CTE 由调用方提供） */
  resolveCteColumns?: (name: string) => VirtualColumn[] | null
}

/**
 * 收集语句中的表引用（含别名）。
 *
 * 扫描 FROM / JOIN / UPDATE / INSERT INTO / DELETE FROM 之后的限定名，
 * FROM 后面的逗号多表也支持；`(SELECT …) 别名` 派生表会静态解析出输出列
 * （`SELECT *` 用 resolveStarColumns 展开），WITH 定义的 CTE 按名字登记
 * （`FROM cte`、`FROM cte x` 都能命中）。
 */
function collectTableRefs(
  statement: string,
  options: TableRefOptions = {},
): TableRef[] {
  const refs: TableRef[] = []

  /*
   * CTE 先解析：派生表内部可能引用同层 CTE（`FROM (SELECT * FROM cte) x`），
   * 而 CTE 的列又要用 `*` 展开，所以这份映射必须在扫描表引用之前就绪。
   * 这里只解析**本层**文本能看到的定义；跨层可见性由 buildScopes 用
   * visibleCtes 回填（子查询能引用外层的 CTE）。
   */
  const ctes = new Map<string, VirtualColumn[] | null>()
  for (const def of collectCteDefs(statement, 0, () => null, options)) {
    // 光标所在的定义体（递归 CTE 自引用）由调用方排除，避免拿自己当可见来源
    if (options.excludeCte?.(def.name)) {
      continue
    }
    const key = def.name.toLowerCase()
    if (!ctes.has(key)) {
      ctes.set(key, def.columns)
    }
  }

  /** 展开 `*` 时查列：先 CTE，再物理表元数据 */
  const lookupColumns = (name: string): VirtualColumn[] | null => {
    const columns = ctes.get(name.toLowerCase())
    return columns ?? options.resolveStarColumns?.({ schema: '', table: name, alias: '' }) ?? null
  }

  /** 按名字取 CTE 输出列：本层定义优先，其次交给调用方（跨层可见的 CTE） */
  const cteColumnsOf = (name: string): VirtualColumn[] | null =>
    ctes.get(name.toLowerCase()) ?? options.resolveCteColumns?.(name) ?? null

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
          const body = statement.slice(probe + 1, close)
          // 内层表引用：把输出列溯源到具体来源表（限定符匹配 / 单表归属）
          const innerRefs = collectTableRefs(body, {
            resolveColumnMeta: options.resolveColumnMeta,
            resolveCteColumns: options.resolveCteColumns,
          })
          refs.push({
            schema: '',
            table: alias.alias,
            alias: alias.alias,
            // `SELECT *` 用内层来源表的列展开；展不开时按「列未知」处理
            virtualColumns: parseSelectOutputColumns(
              body,
              qualifier => starColumnsOf(body, lookupColumns, qualifier),
              (qualifier, column) => resolveColumnOf(innerRefs, qualifier, column, options),
            ) ?? undefined,
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

  // CTE 的物理引用（FROM cte x）升级为虚拟表，并补登记无别名引用的 CTE 名
  const named: TableRef[] = []
  for (const ref of refs) {
    if (ref.schema) {
      continue
    }
    const columns = cteColumnsOf(ref.table)
    if (!columns) {
      continue
    }
    ref.virtualColumns ??= columns
    if (ref.alias && ref.alias.toLowerCase() !== ref.table.toLowerCase()) {
      named.push({ schema: '', table: ref.table, alias: '', virtualColumns: ref.virtualColumns })
    }
  }
  refs.push(...named)
  for (const [name, columns] of ctes) {
    const exists = refs.some(ref =>
      ref.table.toLowerCase() === name || ref.alias.toLowerCase() === name)
    if (!exists) {
      refs.push({ schema: '', table: name, alias: '', virtualColumns: columns ?? undefined })
    }
  }

  return refs
}

/**
 * 把派生表里的一个列引用溯源到来源表。
 *
 *  - 带限定符（`u.name`）：在该层的表引用里按别名 / 表名匹配；
 *  - 不带限定符：只有该层恰好只有一个来源时才敢归属（多表时归属谁都是猜）；
 *  - 来源本身是派生表 / CTE 时直接继承它已解析出的列（连带来源与类型）。
 */
function resolveColumnOf(
  refs: TableRef[],
  qualifier: string,
  column: string,
  options: TableRefOptions,
): VirtualColumn | null {
  const wanted = qualifier.toLowerCase()
  const source = wanted
    ? refs.find(ref => ref.alias.toLowerCase() === wanted || ref.table.toLowerCase() === wanted)
    : refs.length === 1
      ? refs[0]
      : undefined
  if (!source) {
    return null
  }

  const inherited = source.virtualColumns?.find(
    item => item.name.toLowerCase() === column.toLowerCase(),
  )
  if (inherited) {
    return inherited
  }

  const meta = options.resolveColumnMeta?.(source, column)
  return meta
    ? { name: column, from: source.table, dataType: meta.dataType, comment: meta.comment }
    : { name: column, from: source.table }
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
export function unquoteIdent(name: string): string {
  return name.replace(/^[`"[]/, '').replace(/[`"\]]$/, '')
}

/** 一处 CTE 定义：名字、输出列（解析不出为 null）与定义体在文档中的范围 */
interface CteDef {
  name: string
  columns: VirtualColumn[] | null
  /** 定义体 `( … )` 的起始位置（文档坐标，含括号内第一个字符） */
  bodyFrom: number
  /** 定义体 `( … )` 的结束位置（文档坐标，指向 `)`） */
  bodyTo: number
}

/**
 * 解析一段文本里的 CTE 定义：`WITH [RECURSIVE] name [(列, …)] AS (SELECT …), …`。
 *
 * 相比最初的实现，这里补齐了三件事：
 *  - **多处 WITH 都处理**（原来是拿到一处就 break），且只认顶层的 WITH，
 *    子查询里的 WITH 属于更内层的作用域，由那一层自己解析；
 *  - **递归 CTE**：显式列清单先入表，再解析定义体，于是体内 `FROM t` 有列可用；
 *    无列清单时用 SELECT 输出列预注册（可能不准，允许退化）；
 *  - **依赖链**：按声明顺序解析，`WITH a AS (…), b AS (SELECT * FROM a)`
 *    里 `b` 的 `*` 会用 `a` 的输出列展开。
 *
 * @param offset       该段文本在文档中的起点，用于把定义体范围换算成文档坐标
 * @param resolveKnown 查询「本层之外」已可见的 CTE 列（跨层广播用）
 */
function collectCteDefs(
  statement: string,
  offset: number,
  resolveKnown: (name: string) => VirtualColumn[] | null,
  options: TableRefOptions = {},
): CteDef[] {
  const defs: CteDef[] = []
  /** 本层已解析出的 CTE（声明顺序），供依赖链与递归引用 */
  const known = new Map<string, VirtualColumn[] | null>()

  /**
   * CTE 定义体里 `SELECT *` 的列来源：
   * 本层已解析的 CTE → 外部（跨层）已知 CTE → 物理表元数据。
   */
  const lookupColumns = (name: string): VirtualColumn[] | null =>
    known.get(name.toLowerCase())
    ?? resolveKnown(name)
    ?? options.resolveStarColumns?.({ schema: '', table: name, alias: '' })
    ?? null

  for (const match of statement.matchAll(/\bwith\b/gi)) {
    const start = match.index ?? 0
    // 只处理顶层 WITH：括号内的 WITH 属于更内层作用域
    if (!isTopLevel(statement, 0, start)) {
      continue
    }

    let index = skipSpaces(statement, start + match[0].length)
    const recursive = /^recursive\b/i.test(statement.slice(index, index + 10))
    if (recursive) {
      index = skipSpaces(statement, index + 9)
    }

    for (;;) {
      const name = readIdentifier(statement, index)
      if (!name || NON_ALIAS_KEYWORDS.has(name.name.toLowerCase())) {
        break
      }
      index = skipSpaces(statement, name.end)

      // 显式列清单：WITH n(a, b) AS (…) —— 只有名字，没有来源与类型
      let declared: VirtualColumn[] | null = null
      if (statement[index] === '(') {
        const close = matchParen(statement, index)
        if (close < 0) {
          break
        }
        declared = splitTopLevel(statement.slice(index + 1, close))
          .map(part => unquoteIdent(part.trim()))
          .filter(Boolean)
          .map(name => ({ name }))
        index = skipSpaces(statement, close + 1)
      }

      if (!/^as\b/i.test(statement.slice(index, index + 3))) {
        break
      }
      index = skipSpaces(statement, index + 2)
      if (statement[index] !== '(') {
        break
      }
      const bodyStart = index + 1
      const bodyEnd = matchParen(statement, index)
      if (bodyEnd < 0) {
        break
      }
      const body = statement.slice(bodyStart, bodyEnd)

      // 递归 / 有显式列清单：先把自己入表，体内 `FROM t` 才有列可用
      if (recursive || declared) {
        known.set(name.name.toLowerCase(), declared)
      }
      // 定义体内部的表引用：把输出列溯源到来源表（CTE 走 lookup，物理表查元数据）
      const bodyRefs = collectTableRefs(body, {
        resolveColumnMeta: options.resolveColumnMeta,
        resolveCteColumns: name => lookupColumns(name),
      })
      const columns = declared ?? parseSelectOutputColumns(
        body,
        qualifier => starColumnsOf(body, lookupColumns, qualifier),
        (qualifier, column) => resolveColumnOf(bodyRefs, qualifier, column, options),
      )
      known.set(name.name.toLowerCase(), columns)

      defs.push({
        name: name.name,
        columns,
        bodyFrom: offset + bodyStart,
        bodyTo: offset + bodyEnd,
      })

      index = skipSpaces(statement, bodyEnd + 1)
      if (statement[index] === ',') {
        index = skipSpaces(statement, index + 1)
        continue
      }
      break
    }
  }

  return defs
}

/**
 * `SELECT *` / `t.*` 的展开来源：从 FROM 引用的表里找已解析出列的表（CTE 或物理表）。
 *
 * `qualifier` 非空时（`t.*` 写法）优先精确匹配该别名 / 表名；
 * 都找不到就返回 null（列未知），由调用方按「不猜」处理。
 */
function starColumnsOf(
  selectText: string,
  lookup: (name: string) => VirtualColumn[] | null,
  qualifier = '',
): VirtualColumn[] | null {
  const fromIndex = findTopLevelFrom(selectText, 0)
  if (fromIndex < 0) {
    return null
  }

  const refs = collectTableRefs(selectText.slice(fromIndex))
  const wanted = qualifier.toLowerCase()
  const ordered = wanted
    ? [
        ...refs.filter(ref =>
          ref.alias.toLowerCase() === wanted || ref.table.toLowerCase() === wanted),
        ...refs,
      ]
    : refs

  for (const ref of ordered) {
    const columns = lookup(ref.table)
    if (columns) {
      return columns
    }
  }
  return null
}

/** SELECT 输出项：列名 + 可能的列引用（用于溯源到来源表） */
interface OutputItem {
  /** 输出列名（有别名时取别名） */
  name: string
  /** 列引用里的限定符（`t.col` 的 t）；不是列引用时为空 */
  qualifier: string
  /** 列引用里的列名；不是列引用时为空 */
  column: string
}

/**
 * 解析一段 SELECT 的输出列（用于派生表 / CTE）。
 *
 * 名字只接受可静态确定的形式：`expr AS 别名`、`t.col`、别名跟随、裸列名；
 * `*` / `t.*` 交给 `resolveStar` 展开（参数是限定符，空串表示裸 `*`）；
 * 其它无法命名的表达式（如不带别名的 `COUNT(*)`）返回 null，按「列未知」处理。
 *
 * `resolveColumn` 用于把列引用溯源到来源表与字段类型：
 * 单表来源、或列上写了限定符时才敢归属。
 */
function parseSelectOutputColumns(
  selectText: string,
  resolveStar?: (qualifier: string) => VirtualColumn[] | null,
  resolveColumn?: (qualifier: string, column: string) => VirtualColumn | null,
): VirtualColumn[] | null {
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

  const columns: VirtualColumn[] = []
  for (const item of splitTopLevel(list)) {
    const trimmed = item.trim()
    // `*` / `t.*`：能展开就展开（限定符交给回调定位来源表），展不开视为列未知（绝不猜）
    const star = /^(?:([A-Za-z_$][\w$]*)\.)?\*$/.exec(trimmed)
    if (star) {
      const expanded = resolveStar?.(star[1] ?? '')
      if (!expanded) {
        return null
      }
      columns.push(...expanded)
      continue
    }

    const output = readOutputItem(trimmed)
    if (!output) {
      return null
    }
    // 只有列引用才溯源；`COUNT(*) AS c` 这类表达式只有名字
    const traced = output.column
      ? resolveColumn?.(output.qualifier, output.column)
      : null
    columns.push(traced ? { ...traced, name: output.name } : { name: output.name })
  }
  return columns
}

/**
 * 读取 SELECT 输出项；无法静态确定名字时返回 null。
 *
 * 支持 `expr AS 别名`、`t.col`（取最后一段）、`表达式 别名`（别名跟随）、裸列名，
 * 并尽量识别出其中的「列引用」，供上层溯源来源表与类型。
 */
function readOutputItem(item: string): OutputItem | null {
  const asMatch = /\bas\s+(`[^`]*`|"[^"]*"|\[[^\]]*\]|[A-Za-z_$][\w$]*)\s*$/i.exec(item)
  if (asMatch) {
    const name = unquoteIdent(asMatch[1])
    const ref = readColumnRef(item.slice(0, asMatch.index))
    return { name, qualifier: ref?.qualifier ?? '', column: ref?.column ?? '' }
  }

  const tail = /(`[^`]*`|"[^"]*"|\[[^\]]*\]|[A-Za-z_$][\w$]*)\s*$/.exec(item)
  if (!tail) {
    return null
  }
  const token = tail[1]
  const before = item.slice(0, tail.index).trimEnd()

  // t.col / db.t.col：最后一段就是列名
  if (before.endsWith('.')) {
    const ref = readColumnRef(item)
    return ref ? { name: ref.column, qualifier: ref.qualifier, column: ref.column } : null
  }

  // 整项就是一列（可能带引号）
  if (!before) {
    const name = unquoteIdent(token)
    return { name, qualifier: '', column: name }
  }

  // 别名跟随：要求前一个非空白字符是标识符/右括号/引号，
  // 排除 `a + b` 这类以运算符收尾的表达式；`CASE … END` 等关键字不算
  const prevChar = before.slice(-1)
  if (
    /\s$/.test(item.slice(0, tail.index))
    && /[\w$)\]`"]/.test(prevChar)
    && !NON_ALIAS_KEYWORDS.has(token.toLowerCase())
  ) {
    const ref = readColumnRef(before)
    return { name: unquoteIdent(token), qualifier: ref?.qualifier ?? '', column: ref?.column ?? '' }
  }

  return null
}

/**
 * 把一段文本识别成列引用（`col` / `t.col` / `db.t.col`）。
 * 不是纯粹的限定名（含函数、运算符、字面量等）时返回 null。
 */
function readColumnRef(text: string): { qualifier: string, column: string } | null {
  const trimmed = text.trim()
  if (!trimmed) {
    return null
  }
  const parsed = readQualifiedName(trimmed, 0)
  if (!parsed || parsed.end !== trimmed.length || !parsed.parts.length) {
    return null
  }
  const parts = parsed.parts
  return {
    column: parts[parts.length - 1],
    qualifier: parts.length >= 2 ? parts[parts.length - 2] : '',
  }
}
