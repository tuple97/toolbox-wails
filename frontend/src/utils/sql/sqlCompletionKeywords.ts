/**
 * SQL 补全的候选权重与关键字 / 函数清单（纯数据，无逻辑）。
 *
 * 从 sqlCompletion.ts 拆出：这些清单随 SQL 方言 / 产品取舍演进，
 * 集中在一个文件里改起来不用在两千行的补全实现里翻找。
 */
import { SQL_FUNCTION_DOCS } from './functionCatalog'

/**
 * 候选权重（CodeMirror 的 `boost`）—— **类别次序的唯一出处**。
 *
 * 读法分两层：
 *  1. **层与层之间**决定「同一前缀下谁排前面」。层间距取 1000 量级，
 *     远大于编辑器匹配分的波动（同前缀候选通常只差几十分），
 *     所以类别次序稳定，不会被「词更长 / 匹配更绕」翻盘。
 *  2. **同一层内**交给编辑器的匹配分（更短、更精确的词自然靠前）；
 *     层内的小偏移（`+5`、`-5`、高频关键字加成）只做微调，不改变层间次序。
 *
 * 为什么**关键字高于函数**：`SELECT * FR|` 里用户要写的是子句骨架（FROM），
 * 函数（FROM_UNIXTIME）只是前缀撞车。结构关键字位置明确、写下去就是语法结构；
 * 函数在写全 `(` 之前都只是备选。
 */
export const BOOST_COLUMN = 8000
export const BOOST_ALIAS = 7000
export const BOOST_TABLE = 6000
export const BOOST_NAMESPACE = 5500
/** 语句级 / DDL：`SELECT`、`INSERT INTO` … */
export const BOOST_STATEMENT_KEYWORD = 2000
/** 表达式：`AND`、`CASE`、`AS` … */
export const BOOST_EXPRESSION_KEYWORD = 1500
/** 子句：`FROM`、`WHERE`、`GROUP BY` … */
export const BOOST_CLAUSE_KEYWORD = 1200
export const BOOST_FUNCTION = 1000

/**
 * 智能项（`*` 展开 / 分组列 / 比较值 / INSERT 列清单）：9000。
 *
 * 高于列 —— 它们只在该位置才有意义，出来了就该排在最前面，
 * 常规列名候选紧随其后。
 */
export const BOOST_SMART_ITEM = 9000

/**
 * 「上下文优先的列」：如 GROUP BY 位置上的 SELECT 非聚合列。
 *
 * 略高于普通列，但仍低于片段型智能项，
 * 这样「补齐全部列」的入口在最前、它推荐的那些列紧跟其后、其余列照旧。
 */
export const BOOST_SMART_COLUMN = 8500

/*
 * 关键字按「允许出现的位置」分类，补全只给该位置写得出来的那些，
 * 其余一律不弹（矩阵见 sqlCompletion.ts 里 keywordsFor 的说明）。
 */

/** 语句级 / DDL：只有新语句开头（`kind === 'any'`）才给 */
export const STATEMENT_KEYWORDS = [
  'SELECT', 'WITH', 'INSERT INTO', 'UPDATE', 'DELETE FROM', 'CREATE TABLE',
  'DROP TABLE', 'ALTER TABLE', 'TRUNCATE TABLE', 'CREATE INDEX', 'DROP INDEX',
  'SHOW TABLES', 'DESCRIBE', 'EXPLAIN', 'USE',
]

/** 连接：表来源写完后接着写的下一个表 / 关联条件 */
export const JOIN_KEYWORDS = ['JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'ON']

/** 子句：开始一个新子句（表达式写完后收尾或续写） */
export const CLAUSE_KEYWORDS = [
  'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
  'UNION ALL', 'SET', 'VALUES',
]

/** 表达式：条件与表达式内部 */
export const EXPRESSION_KEYWORDS = [
  'AND', 'OR', 'NOT', 'NULL', 'IN', 'BETWEEN', 'LIKE', 'IS NULL', 'EXISTS',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'DISTINCT', 'AS', 'ASC', 'DESC',
]

/** 全部关键字（数组顺序即候选顺序），语句开头一次性给出 */
export const SQL_KEYWORDS = [
  ...STATEMENT_KEYWORDS, ...JOIN_KEYWORDS, ...CLAUSE_KEYWORDS, ...EXPRESSION_KEYWORDS,
]

/** 表达式关键字的集合版，用于决定候选权重 */
export const EXPRESSION_KEYWORD_SET = new Set(EXPRESSION_KEYWORDS)

/** 语句关键字的集合版，用于决定候选权重 */
export const STATEMENT_KEYWORD_SET = new Set(STATEMENT_KEYWORDS)

/**
 * 关键字词表（多词结构拆成单个词、小写）。
 *
 * 与 `RESERVED_WORDS` 的区别：这里**只有关键字**，不含「只是需要引用符的保留字」。
 * `user` / `key` / `rank` 这些是极常见的表名列名（`FROM user|` 就在写 user 表），
 * 把它们当关键字会把位置判错，所以两张表不能混用。
 *
 * 用途：光标扫描判断「紧贴光标的这个词是关键字，还是正在输入的标识符」——
 * 只有前者才由自己决定位置语义，后者要让过（见 sqlCursor 的 scanClause）。
 */
export const KEYWORD_WORDS = new Set(
  SQL_KEYWORDS.flatMap(keyword => keyword.toLowerCase().split(/\s+/)),
)

/**
 * 需要引用符才能当标识符用的保留字。
 *
 * 补全里出现的语句关键字是基础（多词结构拆成单词），另外补一批列名里最常踩到的
 * 保留字 —— 例如 `order` / `key` / `user` / `desc` / `row`。
 *
 * 判据只用于「插入时要不要加引用符」：**宁可多引几个也不能少引**（少引 = 生成的
 * SQL 直接语法错误），所以这里按「MySQL 8 / PostgreSQL 里确实保留」来收，
 * 常见的非保留词（`status` / `type` / `name` / `password`）故意不收，
 * 免得日常列名全被包成反引号。
 */
export const RESERVED_WORDS = new Set([
  // 补全里的关键字（含多词结构拆开后的单词）
  ...KEYWORD_WORDS,
  // 两词结构的后半截（`GROUP BY` / `ORDER BY` 的 by 已在上面的拆分里）
  'group', 'order', 'union', 'cross', 'outer', 'inner', 'left', 'right',
  // 列名里最常见的保留字
  'key', 'index', 'user', 'database', 'schema', 'column',
  'primary', 'foreign', 'references', 'constraint', 'default', 'unique', 'check',
  'rank', 'row', 'rows', 'window', 'match', 'natural', 'except', 'intersect',
  'partition', 'procedure', 'function', 'trigger', 'view', 'comment',
  'grant', 'revoke', 'commit', 'rollback', 'transaction', 'lock', 'unlock',
  'replace', 'ignore', 'force', 'precision',
  'current_user', 'current_date', 'current_time', 'current_timestamp',
])

/*
 * 常用函数（名字 → 一行签名说明），由函数目录派生（functionCatalog.ts）。
 * 目录是函数元数据的唯一出处：补全候选的 detail 与 Ctrl+P 参数提示都从它来，
 * 加一个函数只改目录数据，不需要动任何调用方。
 */
export const SQL_FUNCTIONS: Record<string, string> = Object.fromEntries(
  SQL_FUNCTION_DOCS.map((fn) => {
    const params = fn.params
      .map(param => (param.optional ? `${param.name}?` : param.name))
      .join(', ')
    return [fn.name, `${fn.name}(${params}${fn.variadic ? ', …' : ''})`]
  }),
)
