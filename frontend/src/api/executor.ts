/**
 * 命令执行器 API：任意 SQL 执行（可取消）与库 / 表 / 字段元数据。
 *
 * ExecuteStatement 的 Go 方法接收 context.Context，
 * 因此返回的 CancellablePromise 调用 cancel() 时会同步取消数据库端的查询。
 */
import type { CancellablePromise } from '@wailsio/runtime'
import { ExecuteStatement, ListDatabases, ListTableColumns, ListTables } from './bindings'
import type { ExecutorColumn, ExecutorRequest, ExecutorResult } from '@/types'

/** 执行用户输入的 SQL；cancel() 可终止正在执行的查询 */
export function executeStatement(req: ExecutorRequest): CancellablePromise<ExecutorResult> {
  return ExecuteStatement(req) as unknown as CancellablePromise<ExecutorResult>
}

/** 库列表（连接可见的全部数据库） */
export async function fetchDatabases(connId: number): Promise<string[]> {
  const rows = await ListDatabases(connId)
  return (rows ?? []).map(row => String(row))
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
