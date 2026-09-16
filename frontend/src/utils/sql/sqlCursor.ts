/**
 * SQL 光标的语义分析（文本层）。
 *
 * 这里回答 SQL 侧的「我在哪」：**哪条语句 / 哪个子句 / 什么位置类别 / 正在输入什么**。
 * 与补全主模块的关系：
 *
 * ```
 *   analyzeHybridCursor   语言区域（模板 / 脚本 / 字符串注释 / SQL）
 *         ↓
 *   analyzeSqlCursorText  语句 + 子句 + 位置类别 + 前缀（本文件，纯文本、可廉价调用）
 *         ↓
 *   SqlCursorIntent       再加作用域链（表 / 别名 / CTE，由补全主模块填）
 *         ↓
 *   候选生成              generalSuggestions / smartSuggestions / 点号补全 …
 * ```
 *
 * 之所以分两层：位置判定要在**每次按键**时跑（触发策略），不能查元数据；
 * 而候选生成需要作用域。上面的文本层两种场景共用，口径不会分叉。
 *
 * 子句判定用「同一语句内的反向扫描」而不是完整语法树：补全时语句十有八九
 * 还没写完（正打到 `where u.`），严格 parser 会直接失败，而这里只需要回答
 * 「最近的、同层级的子句关键字是哪个」。
 */
import type { EditorState } from '@codemirror/state'
import { splitSqlStatements } from '@/utils/sql/sqlStatementRanges'
import type { TextRange } from '@/utils/sql/sqlSyntax'

/** 补全所处位置的候选类型 */
export type CompletionContextKind =
  /** 表名位置：FROM / JOIN / INTO / UPDATE 之后 */
  | 'table'
  /** 表达式位置：SELECT 列表 / WHERE / ON / SET / BY 等 */
  | 'column'
  /** 语句头（语句开头或判不出位置） */
  | 'statement-start'
  /** 子句关键字位置（表来源写完之后） */
  | 'keyword'
  /** 别名位置（AS 之后），此处不给候选 */
  | 'alias'
  /** 关联条件位置（JOIN … ON 之后） */
  | 'join-on'
  /** 分组位置（GROUP BY 之后） */
  | 'group-by'
  /** INSERT 列清单内 */
  | 'insert'
  /** 模板片段 `{{ … }}` 内 */
  | 'template'
  /** 脚本编辑器 */
  | 'script'
  /** 无（日志等不补全的编辑器） */
  | 'none'

/**
 * 补全所处位置的候选类型（子句视角）。
 *
 *  - `source`：**表名还没写**（`FROM |`、`JOIN |`、`INTO |`、`FROM t, |`）→ 只给表与库；
 *  - `afterSource`：表来源已写（`FROM t |`、`AS t1 |`）→ 表 + 库 + 连接 / 子句关键字；
 *  - `column`：表达式位置（SELECT / WHERE / ON / SET / BY / 函数参数…）
 *    → 列 + 别名 + 函数 + 关键字；
 *  - `alias`：别名位置（`… AS |`）→ **什么也不给**：这里只能写别名，
 *    列名、函数、关键字全是噪音；
 *  - `any`：判断不出（语句开头、空行）→ 表 + 库 + 全量关键字（含 DDL）。
 */
export type ClauseKind = 'source' | 'afterSource' | 'column' | 'alias' | 'any'

/** 「后面接表」的子句关键字 */
const TABLE_CLAUSE_KEYWORDS = new Set([
  'from', 'join', 'into', 'update', 'table', 'truncate', 'describe',
  'use', 'database', 'schema', 'rename', 'analyze', 'optimize', 'repair',
])

/**
 * 「后面接列 / 表达式」的子句关键字。
 * `desc` / `limit` / `offset` 故意不收：它们后面接的是值或者别的关键字，
 * 而且 `order by x desc` 收尾时反向扫描还要继续往左找 BY，才能判成列位置。
 */
const COLUMN_CLAUSE_KEYWORDS = new Set([
  'select', 'where', 'on', 'and', 'or', 'set', 'by', 'having', 'using',
  'when', 'then', 'else', 'case', 'like', 'in', 'between', 'is', 'not',
  'distinct', 'returning', 'values', 'as', 'order', 'group',
])

/**
 * 反向扫描出的子句结论。
 *
 * 除位置类别外还带上「命中的关键字」与「它左边那个关键字」：
 * 位置细分（关联条件 / 分组 / INSERT 列清单）要靠这两个词区分，
 * 而它们本来就是同一次扫描读出来的，没必要再扫一遍。
 */
export interface ClauseScan {
  kind: ClauseKind
  /** 命中的关键字（小写）；未命中为空串 */
  keyword: string
  /** 命中关键字左边的那个词（如 `GROUP BY` 的 group、`o.user_id` 的 o） */
  previousKeyword: string
}

/** 判断光标处属于哪个子句 */
export function readClauseKind(prefix: string): ClauseKind {
  return scanClause(prefix).kind
}

/** 反向扫描子句上下文（readClauseKind 的实现，额外透出命中的关键字） */
export function scanClause(prefix: string): ClauseScan {
  let index = prefix.length
  let depth = 0
  /** 反向扫描时是否跨过了一个左括号 */
  let enteredParen = false
  /** 已读过的上一个词（用于区分 GROUP BY / ORDER BY 这类两词结构） */
  let previousKeyword = ''

  const result = (kind: ClauseKind, keyword = ''): ClauseScan => ({ kind, keyword, previousKeyword })

  while (index > 0) {
    const ch = prefix[index - 1] ?? ''

    if (/\s/.test(ch)) {
      index--
      continue
    }

    if (ch === ')') {
      depth++
      index--
      continue
    }

    if (ch === '(') {
      enteredParen = true
      depth = Math.max(0, depth - 1)
      index--
      continue
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      index = skipQuotedBackward(prefix, index - 1)
      continue
    }

    // 行注释：跳到行首；块注释：跳到 /* 之前
    if (ch === '-' && prefix[index - 2] === '-') {
      const lineStart = prefix.lastIndexOf('\n', index - 1)
      index = lineStart < 0 ? 0 : lineStart
      continue
    }
    if (ch === '/' && prefix[index - 2] === '*') {
      const blockStart = prefix.lastIndexOf('/*', index - 3)
      index = blockStart < 0 ? 0 : blockStart
      continue
    }

    const word = readWordBackward(prefix, index)
    if (word) {
      const lower = word.text.toLowerCase()
      if (depth === 0) {
        // 括号里的列清单：INSERT INTO t (a, |) / CREATE TABLE t (a |)
        if (enteredParen && (lower === 'into' || lower === 'update' || lower === 'table')) {
          return result('column', lower)
        }
        /*
         * `AS` 之后就是别名本身（表别名 / 列别名）：
         * 光标还在 `AS |` 时不该弹任何候选；
         * 别名已经写完（`AS t1 |`）则回到「表之后」，接下来是 JOIN / WHERE 这些子句关键字。
         */
        if (lower === 'as') {
          return result(prefix.slice(index).trim() ? 'afterSource' : 'alias', lower)
        }
        /*
         * BY 是两词结构的后半截（GROUP BY / ORDER BY），命中时前半截还没读到：
         * 再往左读一个词填进 previousKeyword —— 位置细分才能把「分组」认出来。
         */
        if (lower === 'by') {
          let head = word.start
          while (head > 0 && /\s/.test(prefix[head - 1] ?? '')) {
            head--
          }
          const previous = readWordBackward(prefix, head)
          if (previous) {
            previousKeyword = previous.text.toLowerCase()
          }
          return result('column', lower)
        }
        if (TABLE_CLAUSE_KEYWORDS.has(lower)) {
          /*
           * 表位置再细分：关键字到光标之间有没有内容，决定了「表还没写」还是「已写了表」。
           * `FROM |` → source（只给表/库）；`FROM t |` → afterSource（再给 JOIN/WHERE 等关键字）；
           * `FROM t, |` → 逗号后面又该接表名，回到 source。
           */
          const tail = prefix.slice(index).trim()
          if (!tail || tail.endsWith(',')) {
            return result('source', lower)
          }
          if (tail.includes('(') || tail.includes(')')) {
            return result('any', lower)
          }
          return result('afterSource', lower)
        }
        if (COLUMN_CLAUSE_KEYWORDS.has(lower)) {
          return result('column', lower)
        }
      }
      previousKeyword = lower
      index = word.start
      continue
    }

    index--
  }

  // 进了括号又判断不出关键字：按表达式位置处理（函数参数、子查询列清单等）
  return result(enteredParen ? 'column' : 'any')
}

/** 从 index 向左读一个词，返回词与起始下标 */
function readWordBackward(text: string, index: number): { text: string, start: number } | null {
  let i = index
  while (i > 0 && /[\w$]/.test(text[i - 1] ?? '')) {
    i--
  }
  if (i === index || !/[A-Za-z_$]/.test(text[i] ?? '')) {
    return null
  }
  return { text: text.slice(i, index), start: i }
}

/** 从 index（引号字符）向左找到配对的开引号，返回开引号之前的下标 */
function skipQuotedBackward(text: string, index: number): number {
  const quote = text[index] ?? ''
  let i = index - 1
  while (i >= 0) {
    if (text[i] === quote) {
      // 双写（''）或反斜杠转义：继续往左找
      if (text[i - 1] === quote || text[i - 1] === '\\') {
        i -= 2
        continue
      }
      return i
    }
    i--
  }
  return 0
}

/**
 * 光标所在（可能还没写完）语句中，光标之前的文本。
 *
 * 用补全口径的语句范围（`completionStatementRange`）：
 * 光标停在语句末尾空白或新起一行时也算这条语句，否则会从头把
 * **上一条语句**的子句当成上下文（在 FROM 后面之后接着弹列名）。
 */
export function currentClausePrefix(doc: string, pos: number, statement: TextRange | null): string {
  const start = statement ? statement.from : doc.lastIndexOf(';', pos - 1) + 1
  return doc.slice(Math.max(0, start), pos)
}

/**
 * 补全口径的语句范围：光标所在的**那一条**语句，取不到返回 null。
 *
 * 与 `statementAtCursor`（执行 / 画边框用）的区别：那边要求光标确实"落在"语句里，
 * 空行与语句末尾之后的换行都算不归属；而补全几乎总在"正在写"的位置——
 * 光标停在 `… WHERE ` 之后、或新起一行准备继续写时，必须仍能看到这张表的列，
 * 所以这里把「语句末尾之后、下一条语句之前的空白」也算作该语句。
 */
export function completionStatementRange(doc: string, pos: number, dbType = ''): TextRange | null {
  const statements = splitSqlStatements(doc, dbType)

  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index]
    if (pos >= statement.from && pos <= statement.to) {
      return { from: statement.from, to: statement.to }
    }

    const next = statements[index + 1]
    const beforeNext = !next || pos < next.from
    if (pos > statement.to && beforeNext && doc.slice(statement.to, pos).trim() === '') {
      return { from: statement.from, to: statement.to }
    }
  }

  return null
}

/** 由子句扫描结论细化为位置类别 */
export function sqlContextKindOf(scan: ClauseScan, statementText: string): CompletionContextKind {
  switch (scan.kind) {
    case 'alias':
      return 'alias'
    case 'source':
      return 'table'
    case 'afterSource':
      return 'keyword'
    case 'column':
      // 关联条件：ON 且同一条语句里出现过 JOIN（ON 也会出现在 CREATE INDEX 等语句里）
      if (scan.keyword === 'on' && /\bjoin\b/i.test(statementText)) {
        return 'join-on'
      }
      // 分组：GROUP BY（previousKeyword 是同一个扫描里读出来的 group）
      if (scan.keyword === 'by' && scan.previousKeyword === 'group') {
        return 'group-by'
      }
      // INSERT 的列清单：INTO 之后还没闭合的括号内
      if (scan.keyword === 'into') {
        return 'insert'
      }
      return 'column'
    default:
      return 'statement-start'
  }
}

// ---------------------------------------------------------------- 光标语义

/**
 * SQL 光标语义（文本层）。
 *
 * 一次分析把「在哪条语句 / 什么位置 / 正在输入什么」全部落在这个对象上，
 * 上层（触发策略、候选生成）不再各自推导。
 */
export interface SqlCursorText {
  /** 光标所在语句 */
  statement: TextRange | null
  /** 语句内光标之前的文本（子句扫描的输入） */
  clausePrefix: string
  /** 上面这段文本在文档中的起点 */
  prefixStart: number
  /** 子句扫描结论（含命中的关键字与它左边那个词） */
  clause: ClauseScan
  /** 位置类别（触发策略与候选生成共用） */
  kind: CompletionContextKind
  /** 语句的主关键字（select / update / insert / delete…），判不出为空串 */
  command: string
}

/** 分析光标（只做文本扫描，不查元数据，可在每次按键时廉价调用） */
export function analyzeSqlCursorText(
  state: EditorState,
  pos: number,
  dbType = '',
): SqlCursorText {
  const doc = state.doc.toString()
  const statement = completionStatementRange(doc, pos, dbType)
  const clausePrefix = currentClausePrefix(doc, pos, statement)
  const clause = scanClause(clausePrefix)

  return {
    statement,
    clausePrefix,
    prefixStart: pos - clausePrefix.length,
    clause,
    kind: sqlContextKindOf(clause, clausePrefix),
    command: mainCommandOf(clausePrefix),
  }
}

/** 语句的主关键字：跳过前导空白与注释后的第一个词（select / with / update…） */
function mainCommandOf(clausePrefix: string): string {
  let index = 0
  while (index < clausePrefix.length) {
    const ch = clausePrefix[index]
    if (/\s/.test(ch)) {
      index++
      continue
    }
    if ((ch === '-' && clausePrefix[index + 1] === '-') || ch === '#') {
      const lineEnd = clausePrefix.indexOf('\n', index)
      index = lineEnd < 0 ? clausePrefix.length : lineEnd + 1
      continue
    }
    if (ch === '/' && clausePrefix[index + 1] === '*') {
      const blockEnd = clausePrefix.indexOf('*/', index + 2)
      index = blockEnd < 0 ? clausePrefix.length : blockEnd + 2
      continue
    }
    break
  }

  const match = /^[A-Za-z_]+/.exec(clausePrefix.slice(index))
  return match ? match[0].toLowerCase() : ''
}
