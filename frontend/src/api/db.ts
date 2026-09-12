import {
  DeleteConnection,
  ExecuteQuery,
  GetConnection,
  ListConnections,
  QueryVariableOptions,
  RevealPassword,
  SaveConnection,
  TestConnection,
} from './bindings'
import type { DBConnection, ExecuteRequest, QueryResult } from '@/types'

/** 把后端返回的连接对象规整为前端类型，显式取字段避免夹带额外属性 */
function toConnection(raw: {
  id: number
  name: string
  dbType: string
  host: string
  port: number
  database: string
  username: string
  password: string
  extra: string
}): DBConnection {
  return {
    id: raw.id,
    name: raw.name,
    dbType: raw.dbType,
    host: raw.host,
    port: raw.port,
    database: raw.database,
    username: raw.username,
    password: raw.password,
    extra: raw.extra,
  }
}

/** 读取全部数据库连接 */
export async function fetchConnections(): Promise<DBConnection[]> {
  const list = await ListConnections()
  return list.map(toConnection)
}

/** 读取单个连接 */
export async function fetchConnection(id: number): Promise<DBConnection> {
  const raw = await GetConnection(id)
  if (!raw) {
    throw new Error(`连接不存在（id=${id}）`)
  }
  return toConnection(raw)
}

/** 保存连接（密码由后端加密） */
export function persistConnection(conn: DBConnection): Promise<number> {
  return SaveConnection(conn)
}

/** 删除连接 */
export function removeConnection(id: number): Promise<void> {
  return DeleteConnection(id)
}

/** 测试连接可用性 */
export function testConnection(conn: DBConnection): Promise<void> {
  return TestConnection(conn)
}

/** 解密查看密码明文 */
export function revealPassword(encrypted: string): Promise<string> {
  return RevealPassword(encrypted)
}

/** 执行查询；未指定分页参数时按不分页处理 */
export async function executeQuery(req: ExecuteRequest): Promise<QueryResult> {
  const result = await ExecuteQuery({
    ...req,
    page: req.page ?? 0,
    pageSize: req.pageSize ?? 0,
    total: req.total ?? 0,
    countTotal: req.countTotal ?? false,
  })
  if (!result) {
    throw new Error('查询未返回结果')
  }
  return result
}

/** 执行 SQL 以获取变量的动态下拉选项 */
export async function fetchVariableOptions(
  connId: number,
  query: string,
): Promise<Record<string, unknown>[]> {
  const rows = await QueryVariableOptions(connId, query)
  return rows as Record<string, unknown>[]
}
