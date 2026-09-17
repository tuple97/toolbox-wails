/**
 * SQL completion candidates: clause-aware suggestions, dot completion, smart items
 * (star expansion / group-by promotion / compare values), join conditions and
 * namespace (database) completion.
 *
 * Extracted from sqlCompletion.ts. This layer consumes the cursor semantics
 * (sqlCursor.ts) plus the structure parsing result (sqlSchema.ts) and only
 * produces candidate items - it never touches the editor.
 */
import { startCompletion } from '@codemirror/autocomplete'
import type { Completion } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import type { CompletionFeatureFlags, MetadataProvider } from './sqlCompletion'
import type { ClauseKind, ClauseScan, CompletionContextKind, SqlCursorText } from './sqlCursor'
import {
  BOOST_ALIAS,
  BOOST_CLAUSE_KEYWORD,
  BOOST_EXPRESSION_KEYWORD,
  BOOST_FUNCTION,
  BOOST_NAMESPACE,
  BOOST_SMART_COLUMN,
  BOOST_TABLE,
  CLAUSE_KEYWORDS,
  EXPRESSION_KEYWORDS,
  JOIN_KEYWORDS,
  SQL_FUNCTIONS,
  SQL_KEYWORDS,
} from './sqlCompletionKeywords'
import {
  columnItem,
  openingQuoteBefore,
  quotedIdentApply,
  renderIdent,
} from './sqlCompletionInsert'
import type { ColumnCompletion } from './sqlCompletionInsert'
import { pooledColumnItems } from './sqlCompletionColumnPool'
import type { PoolColumn, PoolSource } from './sqlCompletionColumnPool'
import { aliasForTable, aliasedTableText } from './sqlTableAlias'
import { joinConditionItems } from './sqlCompletionJoin'
import type { JoinSide } from './sqlCompletionJoin'
import {
  comparisonTarget,
  insertTargetTable,
  nonAggregateColumnsOf,
  selectListTail,
  smartFragmentItem,
  starAtSelectListEnd,
} from './sqlSmartItems'
import type { SmartColumn } from './sqlSmartItems'
import { typedValueItems } from './sqlValueSuggestions'
import { quoteIdent } from './rowSql'
import type { SqlDialect } from './rowSql'
import type { TableRef, VirtualColumn } from './sqlSchema'

export function staticOptions(flags: CompletionFeatureFlags = {}): Completion[] {
  const options: Completion[] = SQL_KEYWORDS.map(label => ({ label, type: 'keyword' as const }))
  if (!flags.disableFunctions) {
    options.push(...Object.entries(SQL_FUNCTIONS).map(([label, detail]) => ({
      label,
      type: 'function' as const,
      detail,
      apply: `${label}()`,
    })))
  }
  return options
}

export function columnsOfRef(ref: TableRef, deps: SqlSuggestDeps): SmartColumn[] {
  const { connId, database, metadata } = deps
  return ref.virtualColumns
    ? ref.virtualColumns.map(column => ({
        name: column.name,
        dataType: column.dataType,
        comment: column.comment,
      }))
    : metadata.columns(connId, ref.schema || database, ref.table)
        .map(column => ({
          name: column.name,
          dataType: column.dataType,
          comment: column.comment,
        }))
}

/**
 * 按限定符定位列来源。
 *
 * 没写限定符时，只有「来源唯一」或「只有一个来源含这一列」才敢归属：
 * 多来源下归属谁都是猜。
 */
export function sourceRefOf(
  scopes: TableRef[][],
  qualifier: string,
  column: string,
  columnsOf: (ref: TableRef) => SmartColumn[],
): TableRef | null {
  const refs = scopes[0] ?? []
  if (qualifier) {
    const wanted = qualifier.toLowerCase()
    return refs.find(ref => (ref.alias || ref.table).toLowerCase() === wanted) ?? null
  }
  if (refs.length === 1) {
    return refs[0]
  }
  const hit = refs.filter(ref =>
    columnsOf(ref).some(item => item.name.toLowerCase() === column.toLowerCase()))
  return hit.length === 1 ? hit[0] : null
}

/**
 * GROUP BY 位置的智能项：推荐 SELECT 里**未聚合**的列。
 *
 * 按 GROUP BY 的规范，SELECT 中不带聚合函数的列就该出现在分组里，
 * 所以这些列值得排在普通列候选之前，另外给一个「一次补齐」的片段项。
 * 返回的 `skip` 交给普通列候选去重（否则同一列会出现两次）。
 */
export function groupByPromotion(
  prefix: string,
  pos: number,
  scopes: TableRef[][],
  columnsOf: (ref: TableRef) => SmartColumn[],
  /** 片段型智能项是否可用（disableSnippets 会关掉「一次补齐」这一项） */
  fragments: boolean,
  deps: SqlSuggestDeps,
): { items: Completion[], skip: Set<string> } {
  const { dialect } = deps
  const skip = new Set<string>()
  const tail = selectListTail(prefix)
  if (!tail) {
    return { items: [], skip }
  }

  const items: Completion[] = []
  const seen = new Set<string>()
  for (const column of nonAggregateColumnsOf(tail.text)) {
    const key = column.column.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    skip.add(key)

    const ref = sourceRefOf(scopes, column.qualifier, column.column, columnsOf)
    const meta = ref
      ? columnsOf(ref).find(item => item.name.toLowerCase() === key)
      : undefined
    // SELECT 里写过的限定符优先（`u.created_at` 的推荐项也带 u.），与普通列候选保持一致
    const source = column.qualifier || ref?.alias || ref?.table || ''
    const ident = renderIdent(column.column, dialect)
    items.push({
      ...columnItem({
        name: column.column,
        displayName: source ? `${source}.${column.column}` : undefined,
        insertText: source ? `${source}.${ident}` : ident,
        columnId: {
          schema: ref?.schema,
          table: ref?.table ?? source,
          source,
          column: column.column,
        },
        detail: {
          dataType: meta?.dataType,
          from: ref ? ref.alias || ref.table : undefined,
          comment: meta?.comment,
        },
        dialect,
      }),
      boost: BOOST_SMART_COLUMN,
    })
  }

  if (fragments && items.length) {
    items.unshift(smartFragmentItem(
      '补齐非聚合列',
      `插入 SELECT 中未聚合的 ${items.length} 列`,
      items.map(item => renderIdent(item.label, dialect)).join(', '),
      { from: pos, to: pos },
    ))
  }

  return { items, skip }
}

/** 候选生成共用的依赖（一次补全内不变） */
export interface SqlSuggestDeps {
  connId: number
  database: string
  /** 方言（引号 / 字面量转义） */
  dialect: SqlDialect
  metadata: MetadataProvider
}

/** 子句候选（非点号场景）的输入 */
export interface GeneralSuggestArgs {
  /** SQL 光标语义（位置类别与子句结论） */
  intent: Pick<SqlCursorText, 'kind' | 'clause' | 'clausePrefix' | 'prefixStart'>
  /** 作用域链（内 → 外） */
  scopes: TableRef[][]
  deps: SqlSuggestDeps
  flags?: CompletionFeatureFlags
  /** 已由智能项推荐过的列（小写列名）：不再重复出现一次 */
  skipColumns?: Set<string>
  /** 光标前正在输入的词（只有超宽表的候选取舍会用到） */
  prefix?: string
  /** 表名是否带自动别名（设置项开启 **且** 当前位置是 FROM / JOIN 之后） */
  autoAlias?: boolean
  /**
   * 上一个输出项用的限定符（`SELECT t.user_id, |` 的 `t`）。
   *
   * 多选列时新列要沿用它的 `t.` —— 用户写了一个带别名的列，接着勾选一批列，
   * 期望它们属于同一个来源；不给的话就会出现 `t.user_id, id, email` 这种半截结果。
   * 只在多选模式由宿主传入（单选时保持既有「单来源裸列名」的规则）。
   */
  preferredQualifier?: string
}

export interface SmartItemArgs {
  /** SQL 光标语义（子句 / 位置类别 / 光标前的文本） */
  intent: Pick<SqlCursorText, 'clause' | 'clausePrefix' | 'prefixStart' | 'kind'>
  /** 光标位置（文档坐标） */
  pos: number
  scopes: TableRef[][]
  deps: SqlSuggestDeps
  columnsOf: (ref: TableRef) => SmartColumn[]
  /** 片段型智能项是否可用（disableSnippets 会关掉） */
  fragments: boolean
}

/**
 * 就地追加的智能项：`*` 展开、比较值、INSERT 列清单。
 *
 * GROUP BY 的推荐列由 groupByPromotion 单独处理（它还要参与去重），
 * 这里只负责其余三类，各自都只在「位置确实对得上」时才出现。
 */
export function smartSuggestions(args: SmartItemArgs): Completion[] {
  const items: Completion[] = []
  const refs = args.scopes[0] ?? []

  // ① `*` 展开：只在 SELECT 列表里，且列表末尾就是星号本身（`COUNT(*)` 不算）
  if (args.fragments && args.intent.clause.kind === 'column' && args.intent.clause.keyword === 'select') {
    const tail = selectListTail(args.intent.clausePrefix)
    const star = tail ? starAtSelectListEnd(tail.text) : null
    if (tail && star) {
      const picked = star.qualifier
        ? refs.filter(ref => (ref.alias || ref.table).toLowerCase() === star.qualifier.toLowerCase())
        : refs
      const names: string[] = []
      for (const ref of picked) {
        // 多来源必须带限定符：两张表都有 id 时，展开成裸 id 含义不清
        const scope = picked.length > 1 ? `${ref.alias || ref.table}.` : ''
        for (const column of args.columnsOf(ref)) {
          // 保留字 / 含特殊字符的列名同样要带引用符，否则展开出来的 SQL 跑不通
          names.push(scope + renderIdent(column.name, args.deps.dialect))
        }
      }
      if (names.length) {
        const listStart = args.intent.prefixStart + tail.start
        items.push(smartFragmentItem(
          star.text,
          `展开为 ${names.length} 列：${previewColumns(names)}`,
          names.join(', '),
          { from: listStart + star.start, to: listStart + star.end },
        ))
      }
    }
  }

  /*
   * ② 比较值：`col = |` / `col IN (|`。
   * 候选由「值域数据 + 列类型」共同决定：词典里有这份数据真实出现过的值就给值，
   * 没有值时按类型给常用写法（时间列 → 当前时间 / 今天零点，布尔列 → 真假值）。
   */
  const target = comparisonTarget(args.intent.clausePrefix)
  if (target) {
    const ref = sourceRefOf(args.scopes, target.qualifier, target.column, args.columnsOf)
    const meta = ref
      ? args.columnsOf(ref).find(item => item.name.toLowerCase() === target.column.toLowerCase())
      : undefined
    const values = args.deps.metadata.values
      ? args.deps.metadata.values(
          args.deps.connId,
          ref ? ref.schema || args.deps.database : args.deps.database,
          ref ? ref.table : '',
          target.column,
        )
      : []
    items.push(...typedValueItems({
      column: target.column,
      dataType: meta?.dataType,
      dialect: args.deps.dialect,
      values,
    }))
  }

  // ③ INSERT 列清单：括号内给列名清单，表名之后补上带括号的清单
  if (args.fragments && args.intent.clause.keyword === 'into') {
    const table = insertTargetTable(args.intent.clausePrefix)
    const insideList = args.intent.kind === 'insert'
    if (table && (insideList || args.intent.clause.kind === 'afterSource')) {
      const ref = refs.find(item => item.table.toLowerCase() === table.table.toLowerCase())
      const columns = ref
        ? args.columnsOf(ref)
        : args.deps.metadata.columns(args.deps.connId, table.schema || args.deps.database, table.table)
      if (columns.length) {
        const list = columns.map(column => renderIdent(column.name, args.deps.dialect)).join(', ')
        items.push(smartFragmentItem(
          '全部列',
          `${insideList ? '插入' : '补上'} ${table.table} 的 ${columns.length} 个列名`,
          insideList ? list : `(${list})`,
          { from: args.pos, to: args.pos },
        ))
      }
    }
  }

  return items
}

export function previewColumns(names: string[]): string {
  const text = names.join(', ')
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

export function joinSideOf(ref: TableRef, deps: SqlSuggestDeps): JoinSide {
  const schema = ref.schema || deps.database
  const columns = ref.virtualColumns
    ? ref.virtualColumns.map(column => ({ name: column.name, dataType: column.dataType }))
    : deps.metadata.columns(deps.connId, schema, ref.table)
        .map(column => ({ name: column.name, dataType: column.dataType }))
  return {
    table: ref.table,
    alias: ref.alias || ref.table,
    columns,
    // 外键只存在于物理表；元数据提供者未实现该能力时为空数组（走命名启发式）
    foreignKeys: ref.virtualColumns
      ? []
      : (deps.metadata.foreignKeys?.(deps.connId, schema, ref.table) ?? []),
  }
}

/**
 * ON 位置的关联条件候选。
 *
 * 用当前作用域里「最后加进来的表」与其余表逐个配对：
 * `FROM users u JOIN orders o ON |` → 左值是 orders（刚写的），
 * 右值依次是 users。配不出任何条件时返回空数组（不猜）。
 */
export function joinConditionSuggestions(
  scopes: TableRef[][],
  deps: SqlSuggestDeps,
  joinTarget?: { table: string, alias: string } | null,
): Completion[] {
  const refs = scopes[0] ?? []
  if (refs.length < 2) {
    return []
  }

  const sides = refs.map(ref => joinSideOf(ref, deps))
  const index = joinTarget ? indexOfJoinTarget(sides, joinTarget) : -1
  const active = index >= 0 ? index : sides.length - 1

  return joinConditionItems({
    left: sides[active],
    others: sides.filter((_, position) => position !== active),
  })
}

/** 在已解析的来源里定位「当前 JOIN 的源」（别名优先，其次表名） */
function indexOfJoinTarget(sides: JoinSide[], target: { table: string, alias: string }): number {
  const alias = target.alias.toLowerCase()
  const table = target.table.toLowerCase()
  return sides.findIndex(side =>
    side.alias.toLowerCase() === alias || side.table.toLowerCase() === table)
}

/**
 * 解析点号前的限定符。
 *
 * 支持 `u.`、`user.`、`` `mydb`. ``、`mydb.user.`、`"db"."t".` 等写法，
 * 返回已去引号的各段（最后一个就是紧邻点号的限定符）。
 * 光标前没有紧邻点号时返回 null。
 */
export function readQualifierBeforeCursor(lineBefore: string): string[] | null {
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
export function resolveAfterDot(
  segments: string[],
  scopes: TableRef[][],
  deps: SqlSuggestDeps,
  prefix = '',
): Completion[] {
  const { connId, database, metadata } = deps
  const last = segments[segments.length - 1]
  const qualifier = last.toLowerCase()

  // 1) 逐层找别名（派生表 / CTE 的列来自静态解析，物理表走元数据）
  for (const refs of scopes) {
    const matchedRef = refs.find(ref => (ref.alias || ref.table).toLowerCase() === qualifier)
    if (matchedRef) {
      return sourceColumnSuggestions(matchedRef, deps, prefix)
    }
  }

  // 2) 逐层找无别名的 CTE 名（FROM cte → cte.）
  for (const refs of scopes) {
    const cteRef = refs.find(
      ref => !ref.alias && ref.table.toLowerCase() === qualifier && ref.virtualColumns,
    )
    if (cteRef?.virtualColumns) {
      return virtualColumnSuggestions(
        cteRef.virtualColumns,
        { schema: cteRef.schema, table: cteRef.table, alias: cteRef.table },
        deps.dialect,
        prefix,
        true,
      )
    }
  }

  /*
   * 3) 显式两段（mydb.user.）：倒数第二段是库 / 模式名。
   * 这是**唯一**允许绕过作用域直接查元数据的形式 —— 用户明确写出了库名。
   */
  if (segments.length > 1) {
    const schema = segments[segments.length - 2]
    return columnSuggestions(
      metadata.columns(connId, schema, last),
      { schema, table: last, alias: last },
      deps.dialect,
      prefix,
      true,
    )
  }

  // 4) 当前库里的表名（`users.` 这种写法在库内同样常见）
  if (metadata.tables(connId, database).some(name => name.toLowerCase() === qualifier)) {
    return columnSuggestions(
      metadata.columns(connId, database, last),
      { schema: database, table: last, alias: last },
      deps.dialect,
      prefix,
      true,
    )
  }

  // 5) 库名 → 该库的表
  if (metadata.databases(connId).some(name => name.toLowerCase() === qualifier)) {
    return tableSuggestions(connId, last, deps.dialect, metadata)
  }

  /*
   * 作用域里没有这个来源，也不再「按当前库的同名表猜一次」：
   * 那会让 `WHERE x.|` 突然冒出一张跟当前语句无关的表的字段 ——
   * 用户感知就是「这里为什么莫名有这些字段」。想要按元数据查，写全 `库.表.`。
   */
  return []
}

/** 某个作用域来源的列候选：一律带限定符（文档里的 `u.` 会被替换掉，插入时要写回去） */
function sourceColumnSuggestions(
  ref: TableRef,
  deps: SqlSuggestDeps,
  prefix: string,
): ColumnCompletion[] {
  const source = { schema: ref.schema, table: ref.table, alias: ref.alias || ref.table }
  return ref.virtualColumns
    ? virtualColumnSuggestions(ref.virtualColumns, source, deps.dialect, prefix, true)
    : columnSuggestions(
        deps.metadata.columns(deps.connId, ref.schema || deps.database, ref.table),
        source,
        deps.dialect,
        prefix,
        true,
      )
}

/**
 * 一组列的候选（走候选池：按来源缓存，超宽表按前缀取舍）。
 *
 * `prefix` 是光标前正在输入的词（只有超宽表才会用到）；
 * `qualified` 决定展示名与插入文本是否带限定符（多来源 / 点号补全时为真）。
 */
export function columnSuggestions(
  columns: readonly PoolColumn[],
  source: PoolSource,
  dialect: SqlDialect,
  prefix = '',
  qualified = false,
): ColumnCompletion[] {
  return pooledColumnItems(columns, source, dialect, prefix, qualified)
}

/** 派生表 / CTE 的输出列候选（同样走候选池） */
export function virtualColumnSuggestions(
  columns: VirtualColumn[],
  source: PoolSource,
  dialect: SqlDialect,
  prefix = '',
  qualified = false,
): ColumnCompletion[] {
  return pooledColumnItems(columns, source, dialect, prefix, qualified)
}

export function derivedSourceDetail(columns: VirtualColumn[]): string {
  const sources = [...new Set(columns.map(column => column.from).filter(Boolean))]
  const from = sources.length === 1 ? ` · ${sources[0]}` : ''
  return `派生表${from}（${columns.length} 列）`
}

/**
 * 表补全项（表名一律带引用符，插入时吃掉用户已经敲下的开引号）。
 *
 * `autoAlias` 为真（设置项开启 **且** 当前位置是 FROM / JOIN 之后）时，
 * 每张表给两条候选：带自动别名的排在前面（boost 更高，列表默认高亮的也是它），
 * 以及一条「不加别名」的原样候选 —— 单表查询常常不需要别名，不能只给一种。
 */
export function tableSuggestions(
  connId: number,
  database: string,
  dialect: SqlDialect,
  metadata: MetadataProvider,
  autoAlias = false,
): Completion[] {
  return metadata.tables(connId, database).flatMap((table) => {
    const quoted = quoteIdent(table, dialect)
    const plain: Completion = {
      label: table,
      type: 'class',
      detail: '表 / 视图',
      boost: BOOST_TABLE,
      apply: quotedIdentApply(quoted),
    }
    if (!autoAlias) {
      return [plain]
    }

    const alias = aliasForTable(table)
    if (!alias) {
      return [plain]
    }
    return [
      {
        ...plain,
        label: aliasedTableText(table, alias),
        detail: `表 / 视图 · 自动别名 ${alias}`,
        boost: BOOST_TABLE + 5,
        apply: quotedIdentApply(aliasedTableText(quoted, alias)),
      },
      { ...plain, detail: '表 / 视图 · 不加别名' },
    ]
  })
}

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
export function keywordsFor(kind: ClauseKind): string[] {
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

export function keywordBoost(keyword: string): number {
  return EXPRESSION_KEYWORD_SET.has(keyword) ? BOOST_EXPRESSION_KEYWORD : BOOST_CLAUSE_KEYWORD
}

export const EXPRESSION_KEYWORD_SET = new Set(EXPRESSION_KEYWORDS)

/**
 * 插入文本后自动触发下一轮补全。
 *
 * 用于「选完库名 / 别名后紧接着选表 / 字段」：插入后等一帧再 startCompletion，
 * 否则补全弹层刚被这次插入关掉，立刻重开会闪。
 */
export function applyAndTrigger(insertText: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    view.dispatch({
      changes: { from, to, insert: insertText },
      selection: { anchor: from + insertText.length },
    })
    setTimeout(() => startCompletion(view), 0)
  }
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
export function generalSuggestions(args: GeneralSuggestArgs): Completion[] {
  // 光标语义与依赖在这里摊平：函数体沿用原来的局部名字，改动面最小
  const kind: ClauseKind = args.intent.clause.kind
  const { scopes, deps, flags = {}, skipColumns, autoAlias = false } = args
  const prefix = args.intent.clausePrefix ?? ''
  const { connId, database, dialect, metadata } = deps
  const suggestions: Completion[] = []

  // 别名位置（`AS |`）：这里只能写别名，列名 / 表 / 关键字全是噪音
  if (kind === 'alias') {
    return suggestions
  }

  if (kind === 'column') {
    const seenAliases = new Set<string>()
    const seenColumns = new Set<string>()
    const aliasSuggestions: Completion[] = []

    /*
     * 多来源（JOIN / 逗号多表）时列候选一律带限定符：`u.created_at` 与 `o.created_at`
     * 是两个不同的候选，展示与插入都能区分；单来源时保持裸列名，不啰嗦。
     *
     * 例外是多选列（`SELECT t.user_id, |` 这种）：前一项用了 `t.`，新勾的列必须
     * 沿用同一个来源，否则勾出来会变成 `t.user_id, id, email`。
     */
    const preferred = (args.preferredQualifier ?? '').toLowerCase()

    for (const refs of scopes) {
      for (const ref of refs) {
        const source = ref.alias || ref.table
        const sourceKey = source.toLowerCase()
        // 内层已出现同名来源：外层同名的不再贡献列（作用域遮蔽）
        if (seenAliases.has(sourceKey)) {
          continue
        }
        seenAliases.add(sourceKey)

        /*
         * 列候选走候选池（按来源缓存 + 超宽表按前缀取舍）：
         * 派生表用静态解析出的列，物理表用元数据；来源用「别名优先」的限定符，
         * 于是 `FROM users u` 的列是 u.*，与派生表 / CTE 的行为一致。
         */
        // 该来源的列是否带限定符：多来源一律带；多选列时前一项用的那个来源也带
        const qualified = (scopes[0] ?? []).length > 1
          || (preferred !== '' && source.toLowerCase() === preferred)
        const pool = ref.virtualColumns
          ? virtualColumnSuggestions(
              ref.virtualColumns,
              { schema: ref.schema, table: ref.table, alias: source },
              dialect,
              prefix,
              qualified,
            )
          : pooledColumnItems(
              metadata.columns(connId, ref.schema || database, ref.table),
              { schema: ref.schema, table: ref.table, alias: source },
              dialect,
              prefix,
              qualified,
            )
        for (const item of pool) {
          // 去重按「候选身份」：不同来源的同名列是两个候选，不能只留一个
          const key = item.columnKey ?? item.label.toLowerCase()
          if (seenColumns.has(key) || skipColumns?.has(item.label.toLowerCase())) {
            continue
          }
          seenColumns.add(key)
          suggestions.push(item)
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
    suggestions.push(...tableSuggestions(connId, database, dialect, metadata, autoAlias))
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

  // 函数只在表达式位置给：表名、表之后、别名位置都用不到（也可由 featureFlags 关掉）
  if (kind === 'column' && !flags.disableFunctions) {
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

/**
 * 库名候选的插入：吃掉用户已经敲下的开引号，插入 `` `db`. `` 并再弹一次
 * （接着就能选该库的表）。
 */
export function namespaceApply(identifier: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const open = openingQuoteBefore(view.state.doc.toString(), from)
    const start = open ? open.start : from
    view.dispatch({
      changes: { from: start, to, insert: identifier },
      selection: { anchor: start + identifier.length },
    })
    setTimeout(() => startCompletion(view), 0)
  }
}

export function namespaceSuggestions(
  connId: number,
  dialect: SqlDialect,
  metadata: MetadataProvider,
): Completion[] {
  return metadata.databases(connId).map(name => ({
    label: name,
    type: 'namespace',
    detail: '数据库',
    boost: BOOST_NAMESPACE,
    apply: namespaceApply(`${quoteIdent(name, dialect)}.`),
  }))
}
