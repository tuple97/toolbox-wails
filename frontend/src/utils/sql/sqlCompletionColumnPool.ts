/**
 * 列候选池：按「来源」缓存候选项，并在超宽表上按前缀取舍。
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
 * 候选项带**身份**（表 + 来源 + 列）与**插入文本**（多来源时带限定符）：
 * `u.created_at` 与 `o.created_at` 是两个不同的候选，不会再被去重吞掉。
 *
 * 纯数据模块：不依赖 EditorState / DOM，可在单测里直接验证。
 */
import { columnItem, renderIdent } from './sqlCompletionInsert'
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

/** 候选池的来源描述 */
export interface PoolSource {
  /** 库 / 模式名（未限定为空） */
  schema?: string
  /** 物理表名 / 派生表名 / CTE 名 */
  table: string
  /** 来源限定符：别名；没有别名时就是表名 */
  alias: string
}

/** 中文列名：前缀是 ASCII 时它们仍可能靠拼音首字母命中，截断时要优先保住 */
const CJK_RE = /[\u4e00-\u9fa5]/

/**
 * 前缀截断结果最多缓存几个前缀。
 *
 * 前缀即「正在输入的词」，数量天然有限；限长只是防止长时间连续输入把 Map 撑大。
 */
const MAX_TRIMMED_PREFIXES = 8

/** 元数据数组 → （来源 + 方言 + 是否带限定符）→ 全量候选 */
const pools = new WeakMap<readonly PoolColumn[], Map<string, ColumnCompletion[]>>()

/** 元数据数组 → 缓存键 → 前缀 → 截断后的候选 */
const trimmedPools = new WeakMap<readonly PoolColumn[], Map<string, Map<string, ColumnCompletion[]>>>()

/**
 * 缓存键：来源 / 方言 / 是否带限定符任一不同就是另一组候选。
 *
 * **表名必须参与键**：候选的「来源列」显示的是血缘源头表名（见下面的 detail），
 * 同一个别名指向不同表时（不同作用域里的 `t`）若共用缓存，第二张表会拿到
 * 第一张表的候选 —— 来源列会指着另一张表。
 */
function poolKey(source: PoolSource, dialect: SqlDialect, qualified: boolean): string {
  return `${dialect}\u0000${source.schema ?? ''}\u0000${source.table}\u0000${source.alias}\u0000${qualified ? 'q' : 'p'}`
}

/** 取（或建立）某个来源的全量候选（引用稳定：同一份元数据只构造一次） */
function fullPool(
  columns: readonly PoolColumn[],
  source: PoolSource,
  dialect: SqlDialect,
  qualified: boolean,
): ColumnCompletion[] {
  let byKey = pools.get(columns)
  if (!byKey) {
    byKey = new Map()
    pools.set(columns, byKey)
  }

  const key = poolKey(source, dialect, qualified)
  let items = byKey.get(key)
  if (!items) {
    const qualifier = renderIdent(source.alias, dialect)
    items = columns.map(column => {
      const ident = renderIdent(column.name, dialect)
      return columnItem({
        name: column.name,
        displayName: qualified ? `${source.alias}.${column.name}` : undefined,
        insertText: qualified ? `${qualifier}.${ident}` : ident,
        // 限定符单独给一份：插入时据此判断文档里是不是已经写着了
        prefix: qualified ? `${qualifier}.` : undefined,
        columnId: {
          schema: source.schema,
          table: source.table,
          source: source.alias,
          column: column.name,
        },
        detail: {
          dataType: column.dataType,
          /*
           * 「来源」列显示**血缘源头表名**，不是别名：
           *  - 派生列自带来源表（`(SELECT id FROM users) t1` 的列来自 users）→ 用它，
           *    这正是「这一列的值从哪张表来」的答案；
           *  - 物理列 → 真实表名（带库 / 模式）。别名对「这列是什么」没有信息量，
           *    何况列表左边的展示名本身就是 `t2.agent_desc`，别名已经写在那儿了。
           */
          from: column.from ?? (source.schema ? `${source.schema}.${source.table}` : source.table),
          comment: column.comment,
        },
        dialect,
      })
    })
    byKey.set(key, items)
  }
  return items
}

/**
 * 超限时的取舍：前缀命中 > 中文列名 > 元数据顺序。
 *
 * 前缀匹配用**搜索名**（`label`，裸列名）而不是展示名：用户打的是 `crea`，
 * 不该被 `u.` 前缀影响命中。
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
 * 某个来源的列候选。
 *
 * @param columns   元数据里的列数组（引用即缓存键）
 * @param source    来源（表名 + 别名）：身份、展示与插入都靠它
 * @param dialect   方言：决定标识符引用符
 * @param prefix    光标前正在输入的词（用于超宽表的取舍，可为空）
 * @param qualified 是否带限定符（多来源 / 点号补全时为真）
 */
export function pooledColumnItems(
  columns: readonly PoolColumn[],
  source: PoolSource,
  dialect: SqlDialect,
  prefix: string,
  qualified: boolean,
): ColumnCompletion[] {
  if (!columns.length) {
    return []
  }

  const all = fullPool(columns, source, dialect, qualified)
  if (all.length <= MAX_TABLE_COLUMNS) {
    return all
  }

  let bySource = trimmedPools.get(columns)
  if (!bySource) {
    bySource = new Map()
    trimmedPools.set(columns, bySource)
  }

  const sourceKey = poolKey(source, dialect, qualified)
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
