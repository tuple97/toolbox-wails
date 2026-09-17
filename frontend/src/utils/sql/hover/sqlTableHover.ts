/**
 * 表结构悬停（鼠标停在表名 / 表别名上）。
 *
 * 解析链与文档一致：
 *
 * ```
 *   position → resolveTableAtPosition() → 物理表 / 派生来源
 *            → 列（物理表查元数据，派生表 / CTE 用静态解析出的输出列）
 *            → TableHoverModel（物理表额外带复制用的 CREATE TABLE）
 * ```
 *
 * 与列悬停（sqlCompletionHover）并列：那个答「这一列是什么」，这个答「这张表长什么样」。
 * 两者共用同一套语义解析与元数据缓存，不各自扫一遍 SQL。
 *
 * 派生表 / CTE（`(SELECT …) t`、`WITH c AS (…)`）也给结构：它们的列是结构层
 * 静态推出来的（`TableRef.virtualColumns`），足够回答「这个来源有哪些列」；
 * 但它们**没有建表语句**，卡片据此不显示复制按钮（拿不准就不提供，而不是给个半截 DDL）。
 *
 * 其余边界：模板区域里的 `{{ table }}` 不是表名 —— 由调用方（CodeEditor）先过
 * hybridCursor 的语言区域判定；字符串 / 注释、拿不到列信息时不提示。
 */
import type { EditorState } from '@codemirror/state'
import { inLiteralOrComment } from '@/utils/sql/sqlSyntax'
import type { TextRange } from '@/utils/sql/sqlSyntax'
import { createTableModelOf, generateCreateTableSql } from '../ddl/sqlCreateTable'
import { dialectOf } from '../rowSql'
import { defaultMetadataProvider, sqlContextFromRuntime } from '../sqlCompletion'
import type { CompletionRuntime, MetadataProvider } from '../sqlCompletion'
import type { SqlColumnInfo } from '../sqlCompletionHover'
import { resolveTableAtPosition, scopesAt } from '../semantic/sqlSymbols'
import type { VirtualColumn } from '../sqlSchema'

/** 一次表悬停的模型 */
export interface SqlTableHover {
  /** 稳定身份（缓存与调试用，不用显示文本当身份） */
  sourceId: string
  tableName: string
  /** 库 / schema（PostgreSQL 下是 schema），未限定时为空 */
  schemaName: string
  /** 列信息：**保持元数据 / 解析结果的顺序**，不做任何重排 */
  columns: SqlColumnInfo[]
  /** 复制按钮用的建表语句；派生表 / CTE 没有 DDL，此时为空串 */
  createTableSql: string
  /** 来源是否为派生表 / CTE（没有物理定义，卡片不提供复制） */
  virtual: boolean
}

/** 命中结果：悬停的词范围 + 表结构 */
export interface SqlTableHoverResult {
  from: number
  to: number
  info: SqlTableHover
}

/**
 * 取某个位置上的表结构，供悬停提示使用。
 *
 * 返回的 `from` / `to` 是**光标下的词**范围（悬停卡片挂在鼠标处），
 * 而卡片内容是别名解析到的表 —— 鼠标停在 `u` 上看到的仍是 `users` 的结构。
 */
export function tableHoverAt(
  state: EditorState,
  pos: number,
  runtime: CompletionRuntime,
): SqlTableHoverResult | null {
  const base = resolveHoverSource(state, pos, runtime)
  const word = state.wordAt(pos)
  if (!base || !word) {
    return null
  }
  if (!base.columns.length) {
    // 列还没到位（物理表在等元数据、派生来源解析不出列）：这次不提示
    return null
  }

  return {
    from: word.from,
    to: word.to,
    info: {
      sourceId: base.symbol.id,
      tableName: base.symbol.tableName,
      schemaName: base.symbol.schema,
      columns: base.columns.map(column => ({
        name: column.name,
        table: base.symbol.tableName,
        dataType: column.dataType,
        comment: column.comment || undefined,
      })),
      createTableSql: base.model ? generateCreateTableSql(base.model, base.dialect) : '',
      virtual: base.virtual,
    },
  }
}

/**
 * 右键菜单「复制建表语句」用：只解析物理表 + 生成 DDL，不要求列已就绪。
 *
 * 与悬停共用同一套解析；列还没拉到、或来源是派生表 / CTE（没有 DDL）时返回 null
 * （调用方给提示）。
 */
export function createTableSqlAt(
  state: EditorState,
  pos: number,
  runtime: CompletionRuntime,
): { tableName: string, schema: string, sql: string } | null {
  const base = resolveHoverSource(state, pos, runtime)
  if (!base?.model) {
    return null
  }
  const sql = generateCreateTableSql(base.model, base.dialect)
  return sql
    ? { tableName: base.symbol.tableName, schema: base.symbol.schema, sql }
    : null
}

/** 悬停与「复制建表语句」共用的解析结果 */
interface HoverSource {
  symbol: { id: string, tableName: string, schema: string }
  /** 派生表 / CTE：列为静态解析结果，没有 DDL 模型 */
  virtual: boolean
  columns: VirtualColumn[]
  /** 物理表的建表模型；派生来源为 null */
  model: ReturnType<typeof createTableModelOf> | null
  dialect: ReturnType<typeof dialectOf>
}

/** 位置 → 表 / 派生来源 + 列（拿不准返回 null） */
function resolveHoverSource(
  state: EditorState,
  pos: number,
  runtime: CompletionRuntime,
): HoverSource | null {
  const sql = sqlContextFromRuntime(runtime)
  if (!sql || !state.wordAt(pos) || inLiteralOrComment(state, pos)) {
    return null
  }

  const dialect = dialectOf(sql.dbType)
  const symbol = resolveTableAtPosition(state, pos, sql.dbType)
  if (!symbol) {
    return null
  }

  if (symbol.virtual) {
    /*
     * 派生表 / CTE：结构层已经解析出输出列（含溯源到的来源表与类型），
     * 不需要查元数据，也没有建表语句。
     */
    const virtualColumns = virtualColumnsAt(state, pos, sql.dbType)
    if (!virtualColumns?.length) {
      return null
    }
    return { symbol, virtual: true, columns: virtualColumns, model: null, dialect }
  }

  if (!sql.connId) {
    return null
  }
  const metadata: MetadataProvider = runtime.metadata ?? defaultMetadataProvider
  const columns = metadata.columns(sql.connId, symbol.schema || sql.database, symbol.tableName)
  return {
    symbol,
    virtual: false,
    columns,
    model: createTableModelOf({
      schema: symbol.schema || undefined,
      tableName: symbol.tableName,
      columns,
    }),
    dialect,
  }
}

/**
 * 位置上的派生来源（派生表 / CTE）的输出列。
 *
 * 用作用域链找「范围盖住这个词、且带静态列」的表引用：别名与表名两种写法都覆盖
 * （`FROM (SELECT …) t` 的 `t`、`FROM recent` 的 `recent`）。
 */
function virtualColumnsAt(state: EditorState, pos: number, dbType: string): VirtualColumn[] | null {
  const word = state.wordAt(pos)
  if (!word) {
    return null
  }
  for (const scope of scopesAt(state, pos, dbType)) {
    const hit = scope.refs.find(ref => ref.virtualColumns
      && (containsRange(ref.aliasRange, word) || containsRange(ref.tableRange, word)))
    if (hit?.virtualColumns) {
      return hit.virtualColumns
    }
  }
  return null
}

/** 范围是否覆盖一个词（范围可能不存在：合成的表引用没有位置） */
function containsRange(range: TextRange | undefined, word: TextRange): boolean {
  return Boolean(range && word.from >= range.from && word.to <= range.to)
}
