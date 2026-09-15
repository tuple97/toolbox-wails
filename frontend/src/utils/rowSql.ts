/**
 * 结果行 → SQL 语句（结果表格右键「复制为…」→ INSERT / UPDATE / DELETE）。
 *
 * 约定：
 *  - **UPDATE / DELETE 一律以主键为条件**。主键从 information_schema 读取；
 *    读不到主键、或结果集里不含主键列时直接放弃生成（绝不生成没有条件的语句）。
 *  - 表名优先取「产生该结果的 SQL」里的限定名（如 `mydb`.`user` → 库名 mydb），
 *    取不到再回退到当前库，保证生成的语句带上库名。
 *  - 标识符与字符串按方言转义：MySQL 用反引号、反斜杠转义；PostgreSQL 用双引号。
 */

import { ElMessage } from 'element-plus'
import { executeStatement } from '@/api/executor'
import { copyText } from '@/utils/clipboard'
import type { ContextMenuAction } from '@/types'

/** SQL 方言 */
export type SqlDialect = 'mysql' | 'postgres'

/** 复制类型 */
export type RowSqlKind = 'insert' | 'update' | 'delete'

/** 生成语句所需的上下文（由调用方从当前视图状态提供） */
export interface RowSqlContext {
  /** 连接 ID，用于查主键 */
  connId: number | null
  /** 当前库（未显式选择时为空串，此时用连接默认库） */
  database: string
  /** 连接类型（DBConnection.dbType） */
  dbType: string
  /** 产生该结果集的 SQL，用于解析表名 */
  sql: string
  /** 结果列名（按展示顺序） */
  columns: string[]
  /** 被右键的那一行 */
  row: Record<string, unknown>
}

/** 结果表格右键菜单项：两级结构「复制为… → INSERT / UPDATE / DELETE」 */
export const ROW_SQL_MENU_ITEMS: ContextMenuAction[] = [
  {
    key: 'copy-as',
    label: '复制为…',
    children: [
      { key: 'copy-insert', label: 'INSERT' },
      { key: 'copy-update', label: 'UPDATE（按主键）' },
      { key: 'copy-delete', label: 'DELETE（按主键）' },
    ],
  },
]

/** 把菜单项的 key 映射成复制类型；非本菜单的项返回 null */
export function kindOfMenuItem(key: string): RowSqlKind | null {
  switch (key) {
    case 'copy-insert':
      return 'insert'
    case 'copy-update':
      return 'update'
    case 'copy-delete':
      return 'delete'
    default:
      return null
  }
}

/** 连接类型 → 方言 */
export function dialectOf(dbType: string): SqlDialect {
  const value = (dbType || '').toLowerCase()
  return value === 'postgres' || value === 'postgresql' ? 'postgres' : 'mysql'
}

/** 主键缓存：connId:schema:table → 主键列名 */
const primaryKeyCache = new Map<string, string[]>()

/** 表限定名 */
interface TableRef {
  /** 库/模式名，可能为空 */
  schema: string
  table: string
}

/**
 * 从 SQL 中解析出表限定名。
 *
 * 只取第一个 FROM / UPDATE / INSERT INTO / DELETE FROM 后面的名字，
 * 支持 `db`.`table`、db.table、"db"."table"、[db].[table] 三种写法。
 * 解析失败返回 null（比如结果来自函数或复杂子查询）。
 */
export function parseTableRef(sql: string): TableRef | null {
  const pattern = /(?:\bfrom\b|\bupdate\b|\binsert\s+into\b|\bdelete\s+from\b)\s+([`"[]?[A-Za-z_$][\w$]*[`"\]]?(?:\s*\.\s*[`"[]?[A-Za-z_$][\w$]*[`"\]]?){0,1})/i
  const matched = pattern.exec(sql)
  if (!matched) {
    return null
  }
  const parts = matched[1]
    .split('.')
    .map(part => part.trim().replace(/^[`"[]/, '').replace(/[`"\]]$/, ''))
    .filter(Boolean)

  if (parts.length === 1) {
    return { schema: '', table: parts[0] }
  }
  return { schema: parts[0], table: parts[1] }
}

/**
 * 解析表名。
 *
 * SQL 里写明了限定名就用它；没写时按方言回退到「当前库」——
 * MySQL 的库名直接可用；PostgreSQL 不允许跨库限定名，限定的是 schema，
 * 与后端元数据查询的约定一致（默认 public）。
 */
function resolveTable(ctx: RowSqlContext, dialect: SqlDialect): TableRef | null {
  const parsed = parseTableRef(ctx.sql)
  if (!parsed) {
    return null
  }
  if (parsed.schema) {
    return parsed
  }
  const fallback = dialect === 'mysql' ? ctx.database : 'public'
  return { schema: fallback, table: parsed.table }
}

/** 标识符引用（SQL 补全也用它，保持两处一致） */
export function quoteIdent(name: string, dialect: SqlDialect): string {
  return dialect === 'postgres'
    ? `"${name.replace(/"/g, '""')}"`
    : `\`${name.replace(/`/g, '``')}\``
}

/** 字符串字面量转义 */
function escapeString(text: string, dialect: SqlDialect): string {
  const escaped = text.replace(/'/g, "''")
  // MySQL 默认把反斜杠当转义符；PostgreSQL 默认不处理（standard_conforming_strings）
  return dialect === 'mysql' ? escaped.replace(/\\/g, '\\\\') : escaped
}

/** 单元格值 → SQL 字面量 */
function formatValue(value: unknown, dialect: SqlDialect): string {
  if (value === null || value === undefined) {
    return 'NULL'
  }
  switch (typeof value) {
    case 'number':
      return Number.isFinite(value) ? String(value) : 'NULL'
    case 'bigint':
      return value.toString()
    case 'boolean':
      return value ? '1' : '0'
    default:
      break
  }
  if (value instanceof Date) {
    return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`
  }
  return `'${escapeString(String(value), dialect)}'`
}

/** 生成限定名（带库名） */
function qualify(ref: TableRef, dialect: SqlDialect): string {
  return [ref.schema, ref.table]
    .filter(Boolean)
    .map(name => quoteIdent(name, dialect))
    .join('.')
}

/** 查询表主键（information_schema，MySQL / PostgreSQL 通用结构） */
export async function fetchPrimaryKeys(
  ctx: RowSqlContext,
  ref: TableRef,
  dialect: SqlDialect,
): Promise<string[]> {
  const schema = ref.schema || (dialect === 'mysql' ? ctx.database : 'public')
  const cacheKey = `${ctx.connId}:${schema}:${ref.table}`
  const cached = primaryKeyCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const escapeLiteral = (text: string) => text.replace(/'/g, "''")
  const metaSql = `SELECT kcu.column_name AS name
  FROM information_schema.table_constraints AS tc
  JOIN information_schema.key_column_usage AS kcu
    ON kcu.constraint_name = tc.constraint_name
   AND kcu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'PRIMARY KEY'
    AND tc.table_schema = '${escapeLiteral(schema)}'
    AND tc.table_name = '${escapeLiteral(ref.table)}'
  ORDER BY kcu.ordinal_position`

  const result = await executeStatement({
    connId: ctx.connId ?? 0,
    database: ctx.database,
    sql: metaSql,
    limit: 0,
  })
  const keys = (result?.rows ?? [])
    .map(row => String(row.name ?? Object.values(row)[0] ?? ''))
    .filter(Boolean)

  primaryKeyCache.set(cacheKey, keys)
  return keys
}

/**
 * 生成并复制某一行的 SQL。
 *
 * 失败（表名/主键识别不了、剪贴板不可用）时自行提示，不抛错，
 * 便于直接当菜单回调使用。
 */
export async function copyRowSql(kind: RowSqlKind, ctx: RowSqlContext): Promise<void> {
  const dialect = dialectOf(ctx.dbType)
  const ref = resolveTable(ctx, dialect)
  if (!ref) {
    ElMessage.warning('无法从结果对应的 SQL 中识别表名，已取消生成')
    return
  }

  const target = qualify(ref, dialect)
  const label = kind.toUpperCase()

  try {
    if (kind === 'insert') {
      const names = ctx.columns.map(name => quoteIdent(name, dialect)).join(', ')
      const values = ctx.columns.map(name => formatValue(ctx.row[name], dialect)).join(', ')
      await copyText(`INSERT INTO ${target} (${names}) VALUES (${values});`)
      ElMessage.success('已复制 INSERT 语句')
      return
    }

    // UPDATE / DELETE：必须拿到主键，否则不生成（避免误伤全表）
    const allKeys = await fetchPrimaryKeys(ctx, ref, dialect)
    if (!allKeys.length) {
      ElMessage.warning(`未识别到 ${target} 的主键，已取消生成 ${label}`)
      return
    }
    const keys = allKeys.filter(key => ctx.columns.includes(key))
    if (!keys.length) {
      ElMessage.warning(`结果集里没有主键列（${allKeys.join(', ')}），已取消生成 ${label}`)
      return
    }
    const where = keys
      .map(key => `${quoteIdent(key, dialect)} = ${formatValue(ctx.row[key], dialect)}`)
      .join(' AND ')

    if (kind === 'delete') {
      await copyText(`DELETE FROM ${target} WHERE ${where};`)
      ElMessage.success('已复制 DELETE 语句')
      return
    }

    const sets = ctx.columns
      .filter(name => !keys.includes(name))
      .map(name => `${quoteIdent(name, dialect)} = ${formatValue(ctx.row[name], dialect)}`)
    if (!sets.length) {
      ElMessage.warning('结果集里除主键外没有可更新的列，已取消生成 UPDATE')
      return
    }
    await copyText(`UPDATE ${target} SET ${sets.join(', ')} WHERE ${where};`)
    ElMessage.success('已复制 UPDATE 语句')
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
}
