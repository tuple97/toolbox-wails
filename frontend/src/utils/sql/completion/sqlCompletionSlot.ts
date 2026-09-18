/**
 * 补全槽位（Completion Slot）：光标处「允许出现什么」的语义结论。
 *
 * 与 `CompletionContextKind` 的区别在于粒度：
 *
 * | 光标                 | kind      | slot                 |
 * | -------------------- | --------- | -------------------- |
 * | `SELECT \|`          | column    | select-item-start    |
 * | `SELECT id \|`       | column    | select-expression    |
 * | `FROM \|`            | table     | from-source          |
 * | `FROM users \|`      | keyword   | from-after-source    |
 * | `WHERE \|`           | column    | where-expression     |
 * | `GROUP BY \|`        | group-by  | group-by-expression  |
 * | `ORDER BY \|`        | column    | order-by-expression  |
 * | `JOIN o ON \|`       | join-on   | join-predicate-start |
 * | `JOIN o ON o.\|`     | join-expr | join-expression      |
 *
 * 为什么必须单独有这一层：候选「能不能出现」由槽位决定，`boost` 只决定
 * 「同样合法的候选谁排前面」。以前两件事混在 `keywordsFor(kind)` 与一堆
 * `if (kind !== 'column')` 里，于是 `SELECT |` 会冒出 FROM / WHERE / GROUP BY。
 *
 * 纯函数：只吃光标层的结论，不碰编辑器与元数据（可离线测试）。
 */
import type { CompletionContextKind, SqlColumnIntent } from '../sqlCursor'

/** 补全槽位（文档 §8 的清单；按当前实现只保留用得到的那些） */
export type SqlCompletionSlot =
  /** 语句开头 / 判不出位置 */
  | 'statement-start'
  /** SELECT 列表里新的一项刚开头（`SELECT |`、`SELECT t.`、`SELECT id, |`） */
  | 'select-item-start'
  /** SELECT 列表里已经在表达式内（`SELECT id |`、`SELECT a + `） */
  | 'select-expression'
  /** FROM / JOIN / INTO 之后要写表名 */
  | 'from-source'
  /** 表来源已写完（`FROM users |`）→ 接下来是 JOIN / WHERE 这些子句 */
  | 'from-after-source'
  /** WHERE（含条件内部的 AND / OR） */
  | 'where-expression'
  /** JOIN … ON 之后、条件还没开始写 */
  | 'join-predicate-start'
  /** JOIN 条件表达式内部（`ON o.user_id = |`） */
  | 'join-expression'
  /** GROUP BY */
  | 'group-by-expression'
  /** ORDER BY */
  | 'order-by-expression'
  /** HAVING */
  | 'having-expression'
  /** INSERT 列清单内 / UPDATE SET 的列位置 / VALUES */
  | 'insert-column'
  | 'insert-value'
  | 'update-set-column'
  /** `AS` 之后（只能写别名） */
  | 'alias'
  /** 其余（CASE / WHEN / USING / RETURNING …）：宽松处理，不猜 */
  | 'unknown'

/** 槽位判定的输入：全部来自光标层，不再自己扫文本 */
export interface SlotInput {
  kind: CompletionContextKind
  /** 命中的子句关键字（小写） */
  keyword: string
  /** 命中关键字左边那个词（`GROUP BY` 的 group） */
  previousKeyword: string
  /** 命中关键字之后到光标的内容（trim 过） */
  tail: string
  /** 光标是否紧贴刚读到的那个词 */
  tight: 'none' | 'keyword' | 'name'
  /**
   * 列补全意图（含「这一项还没开始写」的判断）。
   *
   * 可选：只关心「表位置 / 关键字位置」的调用方（以及单测）可以不给，
   * 此时 `SELECT |` 会被当成 `select-expression`（宽松档，不会误拦）。
   */
  column?: SqlColumnIntent
}

/**
 * 光标 → 槽位。
 *
 * 关键判断只有一条：`SELECT` 之后**当前输出项有没有开始写表达式**——
 * 没开始（`SELECT |`）是 `select-item-start`（只给列 / 函数 / CASE / DISTINCT），
 * 开始了（`SELECT id |`）是 `select-expression`（这才该给 FROM / WHERE / GROUP BY）。
 */
export function resolveCompletionSlot(input: SlotInput): SqlCompletionSlot {
  switch (input.kind) {
    case 'statement-start':
      return 'statement-start'
    case 'table':
      return 'from-source'
    case 'keyword':
      return 'from-after-source'
    case 'alias':
      return 'alias'
    case 'insert':
      return 'insert-column'
    case 'group-by':
      return 'group-by-expression'
    case 'join-on':
      return 'join-predicate-start'
    case 'join-expression':
      return 'join-expression'
    case 'column': {
      switch (input.keyword) {
        case 'select':
        // `SELECT DISTINCT |`：DISTINCT 只是列表开头的修饰，位置仍是「新的一项」
        case 'distinct':
        case 'all':
          return input.column?.itemEmpty ? 'select-item-start' : 'select-expression'
        case 'where':
        case 'and':
        case 'or':
          return 'where-expression'
        case 'having':
          return 'having-expression'
        case 'by':
          if (input.previousKeyword === 'group') {
            return 'group-by-expression'
          }
          if (input.previousKeyword === 'order') {
            return 'order-by-expression'
          }
          return 'unknown'
        case 'set':
          return 'update-set-column'
        case 'values':
          return 'insert-value'
        case 'into':
          return 'insert-column'
        case 'on':
          return 'join-expression'
        default:
          // CASE / WHEN / THEN / USING / RETURNING / LIMIT …：不细分，按宽松处理
          return 'unknown'
      }
    }
    default:
      return 'unknown'
  }
}
