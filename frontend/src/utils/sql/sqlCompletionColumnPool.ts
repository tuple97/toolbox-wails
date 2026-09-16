/**
 * 列候选池：按表缓存候选项，并在超宽表上按前缀取舍。
 *
 * 为什么需要：
 *  - **缓存**：补全在每一次按键都会跑，宽表 / 多表 JOIN 时每轮都要把成百上千个
 *    列名重新变成候选项对象。候选项是纯数据、只与元数据有关，可以按表缓存。
 *    键用**元数据数组的引用**（metadataStore 在刷新前返回同一个数组）——
 *    元数据一刷新就是新数组，旧缓存自动失效，不需要额外的失效通知。
 *  - **前缀索引 / 上限**：单表列数是外部输入（可能几百上千列），不设上限会让候选
 *    列表膨胀、每轮排序变慢。超过上限时按「已输入前缀命中 → 中文列名（可能靠拼音命中）
 *    → 元数据顺序」取值，保证用户正在打的列名不会被截掉。
 *
 * 纯数据模块：不依赖 EditorState / DOM，可在单测里直接验证。
 */
import { columnItem } from './sqlCompletionInsert'
import type { ColumnCompletion } from './sqlCompletionInsert'
import type { SqlDialect } from './rowSql'

/** 单表进入候选池的列数上限 */
export const MAX_TABLE_COLUMNS = 400

/** 单次补全的候选总量上限（在排序之后截断，留下的都是最相关的） */
export const MAX_OPTIONS = 800

/** 池里的列形态：物理列与派生列共用的最小描述 */
export interface PoolColumn {
  name: string
  dataType?: string
  comment?: string
  /** 派生列可能有自己的来源表 */
  from?: string
}

/** 中文列名：前缀是 ASCII 时它们仍可能靠拼音首字母命中，截断时要优先保住 */
const CJK_RE = /[\u4e00-\u9fa5]/

/**
 * 前缀截断结果最多缓存几个前缀。
 *
 * 前缀即「正在输入的词」，数量天然有限；限长只是防止长时间连续输入把 Map 撑大。
 */
const MAX_TRIMMED_PREFIXES = 8

/** 元数据数组 → （来源 + 方言）→ 全量候选 */
const pools = new WeakMap<readonly PoolColumn[], Map<string, ColumnCompletion[]>>()

/** 元数据数组 → （来源 + 方言）→ 前缀 → 截断后的候选 */
const trimmedPools = new WeakMap<readonly PoolColumn[], Map<string, Map<string, ColumnCompletion[]>>>()

/** 取（或建立）某张表的全量候选（引用稳定：同一份元数据只构造一次） */
function fullPool(
  columns: readonly PoolColumn[],
  source: string,
  dialect: SqlDialect,
): ColumnCompletion[] {
  let byKey = pools.get(columns)
  if (!byKey) {
    byKey = new Map()
    pools.set(columns, byKey)
  }

  const key = `${dialect}\u0000${source}`
  let items = byKey.get(key)
  if (!items) {
    items = columns.map(column => columnItem(column.name, {
      dataType: column.dataType,
      from: column.from ?? source,
      comment: column.comment,
    }, dialect))
    byKey.set(key, items)
  }
  return items
}

/**
 * 超限时的取舍：前缀命中 > 中文列名 > 元数据顺序。
 *
 * 前缀为空（Ctrl+Space 且没输入任何字符）时用户没给任何信号，
 * 直接按元数据顺序截断——不做任何重排，行为最可预期。
 */
function keepByPrefix(items: ColumnCompletion[], prefix: string): ColumnCompletion[] {
  if (!prefix) {
    return items.slice(0, MAX_TABLE_COLUMNS)
  }

  const preferred: ColumnCompletion[] = []
  const cjk: ColumnCompletion[] = []
  const rest: ColumnCompletion[] = []

  for (const item of items) {
    if (item.label.toLowerCase().startsWith(prefix)) {
      preferred.push(item)
    }
    else if (CJK_RE.test(item.label)) {
      cjk.push(item)
    }
    else {
      rest.push(item)
    }
  }

  return [...preferred, ...cjk, ...rest].slice(0, MAX_TABLE_COLUMNS)
}

/**
 * 某张表的列候选。
 *
 * @param columns 元数据里的列数组（引用即缓存键）
 * @param source  候选描述里的来源表 / 别名
 * @param dialect 方言：决定标识符引用符
 * @param prefix  光标前正在输入的词（用于超宽表的取舍，可为空）
 */
export function pooledColumnItems(
  columns: readonly PoolColumn[],
  source: string,
  dialect: SqlDialect,
  prefix: string,
): ColumnCompletion[] {
  if (!columns.length) {
    return []
  }

  const all = fullPool(columns, source, dialect)
  if (all.length <= MAX_TABLE_COLUMNS) {
    return all
  }

  let bySource = trimmedPools.get(columns)
  if (!bySource) {
    bySource = new Map()
    trimmedPools.set(columns, bySource)
  }

  const sourceKey = `${dialect}\u0000${source}`
  let byPrefix = bySource.get(sourceKey)
  if (!byPrefix) {
    byPrefix = new Map()
    bySource.set(sourceKey, byPrefix)
  }

  const key = prefix.toLowerCase()
  let kept = byPrefix.get(key)
  if (!kept) {
    kept = keepByPrefix(all, key)
    if (byPrefix.size >= MAX_TRIMMED_PREFIXES) {
      const oldest = byPrefix.keys().next().value
      if (oldest !== undefined) {
        byPrefix.delete(oldest)
      }
    }
    byPrefix.set(key, kept)
  }
  return kept
}
