/**
 * 候选资格（Eligibility）：**这个候选有没有资格出现**。
 *
 * 文档强调的一条分界：
 *  - 资格（本模块）：答案只有「能 / 不能」，与分数无关；
 *  - 排序（sqlCompletionRank）：只在**都有资格**的候选之间排先后。
 *
 * 以前这两件事混在一起（`WHERE.boost -= 1000`），于是 `SELECT |` 里
 * FROM / WHERE / GROUP BY 照样出现，只是排在后面。现在它们**根本不会生成**：
 *
 *   `SELECT |`  → slot = select-item-start → 关键字只给 DISTINCT / CASE / EXISTS…
 *   `WHERE |`   → slot = where-expression  → 不给 FROM / JOIN / GROUP BY / ORDER BY
 *   `FROM users |` → slot = from-after-source → 只给 JOIN / WHERE 这些子句关键字
 *
 * 纯函数：只吃「候选种类 + 槽位」，不碰编辑器与元数据（可离线测试）。
 */
import {
  CLAUSE_KEYWORDS,
  EXPRESSION_KEYWORDS,
  JOIN_KEYWORDS,
  SQL_KEYWORDS,
} from '../sqlCompletionKeywords'
import type { SqlCompletionSlot } from './sqlCompletionSlot'

/** 资格判定用的候选种类（由 CM 候选项的 type 映射而来） */
export type SqlCandidateKind =
  | 'column'
  | 'table'
  | 'alias'
  | 'function'
  | 'keyword'
  | 'namespace'
  | 'other'

/** CM 候选项 type → 资格判定用的种类 */
export function candidateKindOf(option: { type?: string }): SqlCandidateKind {
  switch (option.type) {
    case 'field':
      return 'column'
    case 'variable':
      return 'alias'
    case 'function':
      return 'function'
    case 'keyword':
      return 'keyword'
    case 'namespace':
      return 'namespace'
    case 'table':
    // 表 / 视图候选用的是 CM 的 'class' 图标类型（见 tableSuggestions）
    case 'class':
      return 'table'
    default:
      return 'other'
  }
}

/** 资格判定的上下文（槽位 + 该槽位内的细分状态） */
export interface EligibilityContext {
  slot: SqlCompletionSlot
  /** 命中的子句关键字（用来区分 `WHERE |` 与 `WHERE a = 1 |`） */
  keyword: string
  /** 命中关键字之后是否已经有内容 */
  hasTail: boolean
}

/** SELECT 列表刚开头允许的关键字（只给「表达式起手」的那些） */
const ITEM_START_KEYWORDS = ['DISTINCT', 'ALL', 'CASE', 'EXISTS']

/**
 * 表达式之后「下一个子句」的关键字。
 *
 * 条件 / 分组写完（`WHERE a = 1 |`、`GROUP BY a |`）之后，接下来只能是这些 ——
 * FROM / JOIN / WHERE 本身不可能再出现。
 */
const FOLLOWING_CLAUSE_KEYWORDS = CLAUSE_KEYWORDS.filter(keyword =>
  ['GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'OFFSET', 'UNION', 'UNION ALL'].includes(keyword))

/** 只写名字 / 值的位置：关键字一律不给 */
const NAME_ONLY_SLOTS: SqlCompletionSlot[] = [
  'from-source',
  'insert-column',
  'insert-value',
  'update-set-column',
  'alias',
]

/**
 * 该槽位允许出现的关键字（顺序即候选顺序）。
 *
 * 这是 `keywordsFor(kind)` 的替代：粒度从「位置大类」细化到槽位，
 * 于是 `SELECT |` 不会再生成 FROM / WHERE / GROUP BY / ORDER BY。
 */
export function keywordsForSlot(ctx: EligibilityContext): string[] {
  if (NAME_ONLY_SLOTS.includes(ctx.slot)) {
    return []
  }

  switch (ctx.slot) {
    case 'from-after-source':
      return ['AS', ...JOIN_KEYWORDS, ...CLAUSE_KEYWORDS]
    case 'select-item-start':
      return ITEM_START_KEYWORDS
    case 'select-expression':
      return [...EXPRESSION_KEYWORDS, ...JOIN_KEYWORDS, ...CLAUSE_KEYWORDS]
    case 'where-expression':
    case 'having-expression':
    case 'group-by-expression':
      // 条件 / 分组刚开头：FROM、JOIN、GROUP BY、ORDER BY 都不该出现
      return ctx.hasTail
        ? [...EXPRESSION_KEYWORDS, ...FOLLOWING_CLAUSE_KEYWORDS]
        : [...EXPRESSION_KEYWORDS]
    case 'order-by-expression':
      // ORDER BY 位置额外给 ASC / DESC
      return ctx.hasTail
        ? [...EXPRESSION_KEYWORDS, 'ASC', 'DESC', ...FOLLOWING_CLAUSE_KEYWORDS]
        : [...EXPRESSION_KEYWORDS, 'ASC', 'DESC']
    case 'join-predicate-start':
    case 'join-expression':
      return [...EXPRESSION_KEYWORDS]
    default:
      // statement-start / unknown：位置判不出来就宽松给全量
      return SQL_KEYWORDS
  }
}

/**
 * 该候选有没有资格出现在这个槽位。
 *
 * 默认宽松（判不出来就不拦），只对「明显不该在这里」的组合说不 ——
 * 因为漏拦只会让人多看一眼列表，误拦会让本该有的候选消失。
 */
export function isCandidateAllowed(
  option: { type?: string, label: string },
  ctx: EligibilityContext,
): boolean {
  const kind = candidateKindOf(option)

  switch (ctx.slot) {
    case 'from-source':
      // 来源位置：表 / 视图 / CTE / 库名；列名与关键字都不给
      return kind === 'table' || kind === 'namespace'
    case 'from-after-source':
      /*
       * 表来源写完了：给「接下来能写什么」（JOIN / WHERE …）。
       * 表名与库名在这一律不给（`FROM users |` 再冒一遍表列表是典型噪音），
       * 但结构化候选（智能项，如 INSERT 的表名之后补列清单）要留着。
       */
      return kind === 'keyword' || kind === 'other'
    case 'insert-column':
    case 'update-set-column':
      // 列清单 / SET 左侧：只写列
      return kind === 'column' || kind === 'other'
    case 'insert-value':
      // VALUES：函数与字面量，列名在这里没有意义
      return kind === 'function' || kind === 'keyword' || kind === 'other'
    case 'alias':
      return false
    case 'select-item-start':
      return kind !== 'table' && kind !== 'namespace'
    case 'select-expression':
    case 'where-expression':
    case 'having-expression':
    case 'group-by-expression':
    case 'order-by-expression':
    case 'join-predicate-start':
    case 'join-expression':
      // 表达式位置：列 / 别名 / 函数 / 关键字 / 智能项都合理，唯独不该冒出表和库
      return kind !== 'table' && kind !== 'namespace'
    default:
      return true
  }
}
