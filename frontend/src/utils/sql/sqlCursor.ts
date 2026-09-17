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
import { IDENT_BODY_SOURCE, IDENT_SOURCE } from './sqlLexemes'
import { readAlias, readIdentifier, readQualifiedName, skipQuoted } from './sqlSchema'

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
  /** 关联条件位置（`JOIN … ON |`：这里该写整条条件） */
  | 'join-on'
  /** JOIN 条件表达式内部（`ON o.user_id = u.|`：只给列，不再给整条条件） */
  | 'join-expression'
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
  /**
   * 命中关键字之后、到光标之间的文本（已 trim）。
   *
   * 判断「这里是不是刚开了个头」用：`ON |` 还空着（该写整条条件），
   * `ON o.user_id = |` 已经在表达式里了（只该给列）。
   */
  tail: string
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

  const result = (kind: ClauseKind, keyword = '', at = index): ClauseScan =>
    ({ kind, keyword, previousKeyword, tail: prefix.slice(at).trim() })

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
          /*
           * 贴住光标的词更像「正在输入的名字」：`SELECT * FROM or|` 里的 `or`
           * 其实要写成 `orders`，不能让它当关键字抢走 context。
           * 跳过它继续往左找真正的子句关键字（于是落到 `from` → afterSource，照样给表名）。
           *
           * 只在词**紧贴光标**时让步：写完关键字再敲空格（`FROM or |`）不受影响，
           * `AS` / `BY` 两个两词结构在上面单独处理，也不受影响。
           */
          if (index === prefix.length) {
            previousKeyword = lower
            index = word.start
            continue
          }
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
      /*
       * 关联条件：ON 且同一条语句里出现过 JOIN（ON 也会出现在 CREATE INDEX 等语句里）。
       *
       * 但只有「ON 之后还空着」才是「该写整条条件」的位置：
       * `ON |` → join-on（给 `o.user_id = u.id`）；
       * `ON o.user_id = u.|` → join-expression（只给列）。
       */
      if (scan.keyword === 'on' && /\bjoin\b/i.test(statementText)) {
        return scan.tail ? 'join-expression' : 'join-on'
      }
      // `ON … AND |`：还在同一个 ON 子句里，可以再给一条条件
      if ((scan.keyword === 'and' || scan.keyword === 'or') && !scan.tail && isInsideJoinClause(statementText)) {
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

/** 光标处是否还在 ON 子句里（最近的 ON 晚于最近的 WHERE / HAVING） */
function isInsideJoinClause(statementText: string): boolean {
  const lower = statementText.toLowerCase()
  const on = lower.lastIndexOf(' on ')
  if (on < 0) {
    return false
  }
  return on > lower.lastIndexOf(' where ') && on > lower.lastIndexOf(' having ')
}

// ---------------------------------------------------------------- 列补全意图

/**
 * 列补全模式。
 *
 * - `single`：普通单选补全（选一个候选继续写）；**不出现复选框**；
 * - `multi`：多选列模式（勾选若干列，回车一次插入）；**出现复选框**。
 *
 * 这是「补全意图」的语义结果，不是候选类型的自然结果 ——
 * 列候选在任何地方都长得一样，是否多选取决于光标处在什么状态。
 */
export type ColumnCompletionMode = 'single' | 'multi'

/** 光标前那一个输出项是什么（决定 `,|` 与 `, |` 的差别） */
export type PreviousItemKind = 'column' | 'expression' | 'function' | 'unknown'

/**
 * 光标处的列补全意图。
 *
 * 文档要求把 `t.|`、`t.user_id,|`、`t.user_id, |` 三种状态分开表达，
 * 这里就是那份表达：**由结构推导**（子句关键字 + 括号深度 + 逗号位置），
 * 而不是 `prefix === ''` 或 `text.includes(',')` 这类字符串条件。
 */
export interface SqlColumnIntent {
  /** 是否处于 SELECT 列表的列位置（其它子句的列位置不算） */
  isColumnList: boolean
  /** 左侧点号限定符（`t.` 的 t）；没有为空串 */
  qualifier: string
  /** 正在输入的词 */
  prefix: string
  /** 光标左侧是否处于「逗号之后的新输出项」 */
  afterComma: boolean
  /** 逗号之后是否已经落了空白（`,|` 与 `, |` 的分界） */
  commaFollowedBySpace: boolean
  /** 上一个输出项的类型 */
  previousItemKind: PreviousItemKind
  /** 上一个输出项用的限定符（多选时新列沿用它的 `t.`）；没有为空串 */
  previousQualifier: string
  /** 列选择模式 */
  mode: ColumnCompletionMode
}

/** 不在列位置时的默认意图（单选、无限定符） */
function emptyColumnIntent(): SqlColumnIntent {
  return {
    isColumnList: false,
    qualifier: '',
    prefix: '',
    afterComma: false,
    commaFollowedBySpace: false,
    previousItemKind: 'unknown',
    previousQualifier: '',
    mode: 'single',
  }
}

/** 忽略引号后的括号深度（> 0 表示在函数参数 / 子查询括号里） */
function parenDepthOf(text: string): number {
  let depth = 0
  let i = 0
  while (i < text.length) {
    const ch = text[i] ?? ''
    if (ch === `'` || ch === '"' || ch === '`') {
      i = skipQuoted(text, i)
      continue
    }
    if (ch === '(') {
      depth++
    }
    else if (ch === ')') {
      depth--
    }
    i++
  }
  return depth
}

/** 光标所在输出项：原文 + 它的起点是逗号还是 SELECT */
interface OutputItemTail {
  /** 从上一个同层逗号 / SELECT 关键字之后到光标的原文（**保留空白**） */
  text: string
  /** 起点是不是逗号（即「光标落在逗号之后的新一项」） */
  afterComma: boolean
}

/**
 * 光标所在**输出项**的原文 + 起点类型。
 *
 * 保留空白很关键：`,|` 与 `, |` 的区别就是逗号后面有没有落空格，
 * 任何 trim 过的中间结果都会把这条信息丢掉（`ClauseScan.tail` 正是 trim 过的）。
 *
 * 必须**从左往右**扫：只有正向扫描才知道某个逗号处在第几层括号里。
 * 反向扫描会踩坑 —— `SELECT func(a,|` 里那个逗号左边还有 `(`，
 * 但反向扫到它时还没见过 `(`，于是被误判成「输出项边界」（真实 bug，已修）。
 */
function itemTailOf(prefix: string): OutputItemTail {
  let depth = 0
  let boundary = 0
  let afterComma = false
  let i = 0

  while (i < prefix.length) {
    const ch = prefix[i] ?? ''
    if (ch === `'` || ch === '"' || ch === '`') {
      i = skipQuoted(prefix, i)
      continue
    }
    if (ch === '(') {
      depth++
      i++
      continue
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1)
      i++
      continue
    }
    if (ch === ',' && depth === 0) {
      boundary = i + 1
      afterComma = true
      i++
      continue
    }
    const ident = readIdentifier(prefix, i)
    if (ident) {
      if (depth === 0 && ident.name.toLowerCase() === 'select') {
        boundary = ident.end
        afterComma = false
      }
      i = ident.end
      continue
    }
    i++
  }

  return { text: prefix.slice(boundary), afterComma }
}

/**
 * 上一个输出项的原文（最后一个同层逗号**之前那一项**的内容，不含 SELECT 等前导）。
 *
 * 同样从左往右扫，只在「新一项还没开始输入」时调用，用来取它的类型与限定符：
 * `t.user_id` 得到限定符 `t`，于是多选新列能沿用同一个来源。
 */
function previousItemText(prefix: string): string {
  let depth = 0
  let boundary = 0
  let prevBoundary = 0
  let lastComma = -1
  let i = 0

  while (i < prefix.length) {
    const ch = prefix[i] ?? ''
    if (ch === `'` || ch === '"' || ch === '`') {
      i = skipQuoted(prefix, i)
      continue
    }
    if (ch === '(') {
      depth++
      i++
      continue
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1)
      i++
      continue
    }
    if (ch === ',' && depth === 0) {
      prevBoundary = boundary
      boundary = i + 1
      lastComma = i
      i++
      continue
    }
    const ident = readIdentifier(prefix, i)
    if (ident) {
      if (depth === 0 && ident.name.toLowerCase() === 'select') {
        boundary = ident.end
      }
      i = ident.end
      continue
    }
    i++
  }

  return lastComma < 0 ? '' : prefix.slice(prevBoundary, lastComma)
}

/** 输出项的类型：完整列引用 / 函数调用 / 其它表达式 / 空 */
function itemKindOf(item: string): PreviousItemKind {
  const trimmed = item.trim()
  if (!trimmed) {
    return 'unknown'
  }
  const bare = new RegExp(`^${IDENT_SOURCE}$`)
  const qualified = new RegExp(`^${IDENT_SOURCE}\\s*\\.\\s*(${IDENT_SOURCE}|\\*)$`)
  if (bare.test(trimmed) || qualified.test(trimmed)) {
    return 'column'
  }
  return trimmed.endsWith(')') ? 'function' : 'expression'
}

/**
 * 从「语句内光标之前的文本」推导列补全意图。
 *
 * 规则完全由结构给出：
 *
 * | 光标状态            | 依据                                   | 模式    |
 * | ------------------- | -------------------------------------- | ------- |
 * | `SELECT t.`         | SELECT 列表内 + 限定符 + 空前缀         | multi   |
 * | `SELECT `           | SELECT 列表内 + 新项，还没输入          | multi   |
 * | `SELECT t.user_id, `| 逗号后已落空白（新项还没开始输入）      | multi   |
 * | `SELECT t.user_id,` | 逗号紧跟光标（还在上一项的收尾手感里）  | single  |
 * | `SELECT t.em`       | 已经在输入词                            | single  |
 * | `SELECT func(a, `   | 括号深度 > 0，不是 SELECT 列表          | single  |
 * | `INSERT INTO t (a,` | 命中关键字不是 select                   | single  |
 *
 * 「逗号紧跟光标 = single」是产品规则：`t.user_id,|` 是**继续写下一列**的手感，
 * 此时不该弹一屏复选框；用户主动落下空格（`, |`）才算「开始新的一项」。
 */
export function readColumnIntent(prefix: string): SqlColumnIntent {
  const scan = scanClause(prefix)
  const intent = emptyColumnIntent()
  if (scan.kind !== 'column' || scan.keyword !== 'select') {
    return intent
  }

  /*
   * tail 是「当前输出项」的原文（光标前最后一个同层逗号 / SELECT 之后的全部文本，
   * **保留空白**）：`,|` 与 `, |` 的差别全在里面，所以不能用 ClauseScan.tail ——
   * 那份是 trim 过的，正好把要判的那个空格吃掉了。
   */
  const item = itemTailOf(prefix)
  if (parenDepthOf(item.text) !== 0) {
    return intent
  }

  const afterComma = item.afterComma
  const itemText = item.text
  const commaFollowedBySpace = afterComma && /^\s/.test(itemText)
  const previousText = afterComma ? previousItemText(prefix) : ''

  const { qualifier, prefix: word } = qualifierAndPrefix(itemText)
  const mode: ColumnCompletionMode = (() => {
    // 逗号紧跟光标：继续写下一列的单选状态
    if (afterComma && !commaFollowedBySpace) {
      return 'single'
    }
    // 逗号后落空白 / 限定符后空前缀 / 列表刚开：都是「新的一项还没开始输入」
    if (!word) {
      return 'multi'
    }
    return 'single'
  })()

  return {
    isColumnList: true,
    qualifier,
    prefix: word,
    afterComma,
    commaFollowedBySpace,
    previousItemKind: itemKindOf(previousText),
    previousQualifier: previousQualifierOf(previousText),
    mode,
  }
}

/**
 * 输出项里的「词 + 左侧限定符」。
 *
 * `t.` → qualifier `t`、prefix 空串；`t.em` → `t` / `em`；`em` → 空串 / `em`。
 * 限定符必须紧贴点号，所以「表达式里的点号」（`a + b.`）不会被误认成限定符。
 */
function qualifierAndPrefix(itemText: string): { qualifier: string, prefix: string } {
  const trimmed = itemText.trimEnd()
  const word = new RegExp(`${IDENT_BODY_SOURCE}$`).exec(trimmed)?.[0] ?? ''
  const before = trimmed.slice(0, trimmed.length - word.length)
  const dot = /\.\s*$/.exec(before)
  if (!dot) {
    return { qualifier: '', prefix: word }
  }
  const head = before.slice(0, dot.index).trimEnd()
  const qualifier = new RegExp(`(${IDENT_SOURCE})$`).exec(head)?.[1] ?? ''
  return { qualifier, prefix: word }
}

/** 上一个输出项用的限定符（`t.user_id` → `t`；没有则空串） */
function previousQualifierOf(itemText: string): string {
  const trail = new RegExp(`(${IDENT_SOURCE})\\s*\\.\\s*${IDENT_SOURCE}\\s*$`).exec(itemText.trim())
  return trail?.[1] ?? ''
}

// ---------------------------------------------------------------- 光标语义

/**
 * SQL 光标语义（文本层）。
 *
 * 一次分析把「在哪条语句 / 什么位置 / 正在输入什么 / 列补全是什么意图」全部落在
 * 这个对象上，上层（触发策略、候选生成、复选框渲染）不再各自推导。
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
  /** 列补全意图（列模式 / 限定符 / 逗号状态；复选框与空格都据此判断） */
  column: SqlColumnIntent
  /** 语句的主关键字（select / update / insert / delete…），判不出为空串 */
  command: string
  /**
   * 当前 JOIN 的源（最近一个 `JOIN` 后面的表与别名）。
   *
   * 关联条件生成用它当「ON 左侧的表」，而不是靠作用域数组的先后顺序猜 ——
   * 派生表、CTE、多级 JOIN 混在一起时，顺序并不可靠。取不到时为 null。
   */
  joinTarget: { table: string, alias: string } | null
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
    column: readColumnIntent(clausePrefix),
    command: mainCommandOf(clausePrefix),
    joinTarget: joinTargetOf(clausePrefix),
  }
}

/**
 * 取最近一个 `JOIN` 后面的表与别名。
 *
 * `JOIN orders o ON …` → `{ table: 'orders', alias: 'o' }`。
 * `JOIN (SELECT …) o ON …` 这种派生表拿不到（返回 null），
 * 调用方退回「作用域里最后加入的表」。
 */
function joinTargetOf(clausePrefix: string): { table: string, alias: string } | null {
  let end = -1
  for (const match of clausePrefix.matchAll(/\bjoin\b/gi)) {
    end = (match.index ?? 0) + match[0].length
  }
  if (end < 0) {
    return null
  }

  const rest = clausePrefix.slice(end)
  const parsed = readQualifiedName(rest, 0)
  if (!parsed?.parts.length) {
    return null
  }

  const table = parsed.parts[parsed.parts.length - 1]
  const alias = readAlias(rest, parsed.end)?.alias ?? table
  return { table, alias }
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
