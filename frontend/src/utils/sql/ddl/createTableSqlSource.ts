/**
 * 建表语句的来源选择：**优先数据库自己给的 DDL**，拿不到再用元数据生成。
 *
 * 两者的差别不是「够不够快」，而是「够不够全」：数据库的 `SHOW CREATE TABLE`
 * 带索引、主键、自增、引擎、字符集、默认值；本地生成器只能按
 * information_schema 的列信息拼，索引这类拿不到。
 *
 * 缓存策略：只缓存**成功的原生 DDL**（同一张表复制多次不打重复往返）。
 * 失败不做负缓存 —— 连接刚断开、权限刚被改这类情况下一律回退本地生成，
 * 下次再问一遍是值得的；把「暂时拿不到」记成永久结论反而会一直用次优结果。
 */
import { fetchCreateTableSql } from '@/api/executor'
import type { SqlDialect } from '../rowSql'

/** 这份 DDL 从哪来（界面据此告诉用户，不必猜） */
export type CreateTableSqlSource = 'database' | 'generated'

export interface CreateTableSqlResult {
  sql: string
  source: CreateTableSqlSource
}

export interface CreateTableSqlArgs {
  connId: number
  /** 当前库（MySQL 库名 / PostgreSQL schema） */
  database: string
  dbType: string
  /** 表所在的 schema（来自 SQL 里的限定名；空表示用当前库） */
  schema?: string
  table: string
  /** 本地按元数据生成的 DDL：拿不到原生 DDL 时用它 */
  generated: string
}

/**
 * 原生 DDL 缓存：键为 连接 + 库/schema + 表。
 *
 * 带 TTL（5 分钟）而不是永久：表结构被人 ALTER 过之后，缓存里的 DDL 会过期，
 * 而缓存本身没有可靠的失效信号 —— 过一会儿再问一次是成本最低的自愈方式。
 */
const nativeCache = new Map<string, { sql: string, at: number }>()

/** 原生 DDL 的缓存有效期 */
const CACHE_TTL_MS = 5 * 60 * 1000

/** 按「原生优先」的策略给出建表语句 */
export async function resolveCreateTableSql(args: CreateTableSqlArgs): Promise<CreateTableSqlResult> {
  const native = await nativeCreateTableSql(args)
  return native ? { sql: native, source: 'database' } : { sql: args.generated, source: 'generated' }
}

/** 原生 DDL（拿不到返回空串）；PostgreSQL 直接跳过，不白跑一次往返 */
async function nativeCreateTableSql(args: CreateTableSqlArgs): Promise<string> {
  if (!args.connId || !args.table || /^postgres/i.test(args.dbType)) {
    return ''
  }

  const schema = args.schema || args.database
  const key = `${args.connId}:${schema}:${args.table}`
  const cached = nativeCache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.sql
  }

  try {
    const sql = await fetchCreateTableSql(args.connId, schema, args.table)
    if (sql) {
      nativeCache.set(key, { sql, at: Date.now() })
    }
    return sql
  }
  catch {
    // 连不上 / 连接被删：当作没有原生 DDL，本地生成照样可用
    return ''
  }
}
