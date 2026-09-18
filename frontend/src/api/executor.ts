/**
 * 命令执行器 API：任意 SQL 执行（可取消）与库 / 表 / 字段元数据。
 *
 * ExecuteStatement 的 Go 方法接收 context.Context，
 * 因此返回的 CancellablePromise 调用 cancel() 时会同步取消数据库端的查询。
 */
import type { CancellablePromise } from '@wailsio/runtime'
import {
  ExecuteStatement,
  FetchCreateTableSQL,
  ListDatabases,
  ListForeignKeys,
  ListTableColumns,
  ListTables,
} from './bindings'
import type {
  DatabaseInfo,
  ExecutorColumn,
  ExecutorRequest,
  ExecutorResult,
  TableForeignKey,
} from '@/types'

/**
 * 执行用户输入的 SQL；cancel() 可终止正在执行的查询。
 *
 * 分页没有开关：page 大于 0 即分页（页大小缺省由后端取默认值），
 * page 传 0 表示本次不分页（对应界面上把页大小设为 0）。
 */
export function executeStatement(req: ExecutorRequest): CancellablePromise<ExecutorResult> {
  return ExecuteStatement({
    ...req,
    page: req.page ?? 0,
    pageSize: req.pageSize ?? 0,
    total: req.total ?? 0,
    countTotal: req.countTotal ?? false,
    // 生产库写操作的确认标记（后端会校验，默认不确认）
    allowProductionWrite: req.allowProductionWrite ?? false,
  }) as unknown as CancellablePromise<ExecutorResult>
}

/**
 * 库列表（连接可见的全部数据库）。
 *
 * `isSystem` 由后端按方言判定（MySQL 与 PostgreSQL 的自带对象不同）：
 * 前端只按设置项过滤，不自己维护一份方言表 —— 见 utils/sql/sqlVisibility.ts。
 */
export async function fetchDatabases(connId: number): Promise<DatabaseInfo[]> {
  const rows = await ListDatabases(connId)
  return (rows ?? []).map(row => ({
    name: String(row?.name ?? ''),
    isSystem: Boolean(row?.isSystem),
  }))
}

/** 表与视图列表 */
export async function fetchTables(connId: number, database: string): Promise<string[]> {
  const rows = await ListTables(connId, database)
  return (rows ?? []).map(row => String(row))
}

/** 表字段（名称 / 类型 / 注释），智能补全用 */
export async function fetchTableColumns(
  connId: number,
  database: string,
  table: string,
): Promise<ExecutorColumn[]> {
  const list = await ListTableColumns(connId, database, table)
  return (list ?? []).map(item => ({
    name: String(item?.name ?? ''),
    dataType: String(item?.dataType ?? ''),
    comment: String(item?.comment ?? ''),
  }))
}

/**
 * 数据库自己的建表语句（`SHOW CREATE TABLE`，目前 MySQL / MariaDB 支持）。
 *
 * 返回空串表示「这个方言 / 这张表拿不到原生 DDL」—— 这是常态而不是故障
 * （PostgreSQL 没有对应语句、表不存在、权限不足），调用方据此回退到本地生成。
 * 绑定文件尚未生成（开发期忘了 `pnpm gen:bindings`）时同样按拿不到处理，
 * 这样旧绑定不会让功能直接崩掉。
 */
export async function fetchCreateTableSql(
  connId: number,
  database: string,
  table: string,
): Promise<string> {
  if (typeof FetchCreateTableSQL !== 'function') {
    return ''
  }
  const ddl = await FetchCreateTableSQL(connId, database, table)
  return String(ddl ?? '').trim()
}

/** 表的外键约束（关联条件补全用） */
export async function fetchForeignKeys(
  connId: number,
  database: string,
  table: string,
): Promise<TableForeignKey[]> {
  const list = await ListForeignKeys(connId, database, table)
  return (list ?? []).map(item => ({
    column: String(item?.column ?? ''),
    referencedTable: String(item?.referencedTable ?? ''),
    referencedColumn: String(item?.referencedColumn ?? ''),
  }))
}
