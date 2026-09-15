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

/**
 * 把后端返回的连接对象规整为前端类型，显式取字段避免夹带额外属性。
 *
 * 注意：这里是**白名单**式映射，后端 DBConnection 新增字段时必须同步补在这里，
 * 否则新参数会在这一层被静默丢掉（表单里填了、保存后看起来没生效）。
 */
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
  note?: string | null
  color?: string | null
  charset?: string | null
  defaultSchema?: string | null
  connectTimeoutSecs?: number | null
  queryTimeoutSecs?: number | null
  keepaliveSecs?: number | null
  sslMode?: string | null
  sslCaPath?: string | null
  sslCertPath?: string | null
  sslKeyPath?: string | null
  urlParams?: string | null
  readOnly?: boolean | null
  isLocal?: boolean | null
  isTest?: boolean | null
  isProduction?: boolean | null
}): DBConnection {
  return {
    id: Number(raw.id ?? 0),
    name: String(raw.name ?? ''),
    dbType: String(raw.dbType ?? 'mysql'),
    host: String(raw.host ?? ''),
    port: Number(raw.port ?? 0),
    database: String(raw.database ?? ''),
    username: String(raw.username ?? ''),
    password: String(raw.password ?? ''),
    extra: String(raw.extra ?? ''),
    note: String(raw.note ?? ''),
    color: String(raw.color ?? ''),
    charset: String(raw.charset ?? ''),
    defaultSchema: String(raw.defaultSchema ?? ''),
    connectTimeoutSecs: Number(raw.connectTimeoutSecs ?? 0),
    queryTimeoutSecs: Number(raw.queryTimeoutSecs ?? 0),
    keepaliveSecs: Number(raw.keepaliveSecs ?? 0),
    sslMode: String(raw.sslMode ?? ''),
    sslCaPath: String(raw.sslCaPath ?? ''),
    sslCertPath: String(raw.sslCertPath ?? ''),
    sslKeyPath: String(raw.sslKeyPath ?? ''),
    urlParams: String(raw.urlParams ?? ''),
    readOnly: Boolean(raw.readOnly ?? false),
    isLocal: Boolean(raw.isLocal ?? false),
    isTest: Boolean(raw.isTest ?? false),
    isProduction: Boolean(raw.isProduction ?? false),
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
