/**
 * SQL 函数目录：**函数元数据的唯一出处**。
 *
 * 谁消费它：
 *  - 补全候选的函数列表与签名说明（sqlCompletionKeywords.SQL_FUNCTIONS 由这里派生）；
 *  - Ctrl+P 参数提示（sqlParameterInfo）：参数名逐个列出、当前参数高亮、
 *    附函数描述与返回类型。
 *
 * 为什么做成声明式目录：函数集合随方言 / 产品取舍演进，**加一个函数只该改数据**。
 * 这里不写任何解析或 UI 逻辑；识别「光标在不在某个函数的参数列表里」是
 * sqlParameterInfo 的职责，它也只依赖本目录判断「这个标识符是不是受支持的函数」。
 *
 * 扩展方式：往 `SQL_FUNCTION_DOCS` 里加一条（params 用中性的参数名，
 * 可选参数标 `optional`，可重复的把最后一个参数名以 `…` 结尾并标 `variadic`），
 * 补全与参数提示同时生效，不需要改任何调用方。
 */

/** 一个参数：`name` 是展示名，`optional` 为可选，`variadic` 标记可重复 */
export interface SqlFunctionParam {
  name: string
  description?: string
  optional?: boolean
}

/** 一个函数的完整元数据 */
export interface SqlFunctionDoc {
  /** 函数名（大写，查找时大小写不敏感） */
  name: string
  /** 一句话说明 */
  description: string
  params: SqlFunctionParam[]
  /** 末参数可重复（如 CONCAT 的任意多个值） */
  variadic?: boolean
  /** 返回类型说明（可选） */
  returns?: string
}

export const SQL_FUNCTION_DOCS: SqlFunctionDoc[] = [
  {
    name: 'COUNT',
    description: '统计行数；参数写 * 统计所有行，写列名时跳过 NULL',
    params: [{ name: '表达式' }],
    returns: '数值',
  },
  {
    name: 'SUM',
    description: '对数值列求和，忽略 NULL',
    params: [{ name: '数值表达式' }],
    returns: '数值',
  },
  {
    name: 'AVG',
    description: '对数值列求平均，忽略 NULL',
    params: [{ name: '数值表达式' }],
    returns: '数值',
  },
  {
    name: 'MIN',
    description: '取最小值',
    params: [{ name: '表达式' }],
    returns: '与列同类型',
  },
  {
    name: 'MAX',
    description: '取最大值',
    params: [{ name: '表达式' }],
    returns: '与列同类型',
  },
  {
    name: 'GROUP_CONCAT',
    description: '把分组内的多个值拼成一个字符串',
    params: [
      { name: '表达式' },
      { name: '分隔符', optional: true },
    ],
    returns: '文本',
  },
  {
    name: 'IFNULL',
    description: '值为 NULL 时用默认值替代',
    params: [{ name: '值' }, { name: '默认值' }],
    returns: '与值同类型',
  },
  {
    name: 'COALESCE',
    description: '返回参数中第一个非 NULL 的值，全为 NULL 时返回 NULL',
    params: [{ name: '值1' }, { name: '值2…', optional: true }],
    variadic: true,
    returns: '与值同类型',
  },
  {
    name: 'NOW',
    description: '当前日期时间',
    params: [],
    returns: '时间',
  },
  {
    name: 'DATE_FORMAT',
    description: '按格式串格式化日期（MySQL 格式：%Y 年、%m 月、%d 日）',
    params: [{ name: '日期' }, { name: '格式' }],
    returns: '文本',
  },
  {
    name: 'STR_TO_DATE',
    description: '按格式串把文本解析成日期',
    params: [{ name: '文本' }, { name: '格式' }],
    returns: '时间',
  },
  {
    name: 'CONCAT',
    description: '把多个值拼接成一个字符串；任一参数为 NULL 则结果为 NULL',
    params: [{ name: '值1' }, { name: '值2…', optional: true }],
    variadic: true,
    returns: '文本',
  },
  {
    name: 'SUBSTRING',
    description: '截取子串；起点从 1 开始，长度可省（取到结尾）',
    params: [
      { name: '文本' },
      { name: '起点' },
      { name: '长度', optional: true },
    ],
    returns: '文本',
  },
  {
    name: 'LENGTH',
    description: '文本的字节长度（字符数用 CHAR_LENGTH）',
    params: [{ name: '文本' }],
    returns: '数值',
  },
  {
    name: 'TRIM',
    description: '去掉两端空白',
    params: [{ name: '文本' }],
    returns: '文本',
  },
  {
    name: 'UPPER',
    description: '转大写',
    params: [{ name: '文本' }],
    returns: '文本',
  },
  {
    name: 'LOWER',
    description: '转小写',
    params: [{ name: '文本' }],
    returns: '文本',
  },
  {
    name: 'ROUND',
    description: '四舍五入；小数位可省（默认 0，即取整）',
    params: [
      { name: '数值' },
      { name: '小数位', optional: true },
    ],
    returns: '数值',
  },
  {
    name: 'FLOOR',
    description: '向下取整',
    params: [{ name: '数值' }],
    returns: '数值',
  },
  {
    name: 'CEIL',
    description: '向上取整',
    params: [{ name: '数值' }],
    returns: '数值',
  },
  {
    name: 'UNIX_TIMESTAMP',
    description: '日期时间转 Unix 时间戳（秒）；不传参数时取当前时间',
    params: [{ name: '日期时间', optional: true }],
    returns: '数值',
  },
  {
    name: 'FROM_UNIXTIME',
    description: 'Unix 时间戳转日期时间',
    params: [
      { name: '时间戳' },
      { name: '格式', optional: true },
    ],
    returns: '时间',
  },
  {
    name: 'DATE_ADD',
    description: '日期加一段时间，如 DATE_ADD(create_time, INTERVAL 1 DAY)',
    params: [{ name: '日期' }, { name: '间隔（INTERVAL n 单位）' }],
    returns: '时间',
  },
  {
    name: 'DATE_SUB',
    description: '日期减一段时间，写法同 DATE_ADD',
    params: [{ name: '日期' }, { name: '间隔（INTERVAL n 单位）' }],
    returns: '时间',
  },
  {
    name: 'DATEDIFF',
    description: '两个日期相差的天数（后者减前者）',
    params: [{ name: '日期1' }, { name: '日期2' }],
    returns: '数值',
  },
]

/** 按名字（大小写不敏感）取函数元数据；不在目录里返回 null */
export function functionDocOf(name: string): SqlFunctionDoc | null {
  return INDEX.get(name.trim().toUpperCase()) ?? null
}

const INDEX = new Map(SQL_FUNCTION_DOCS.map(doc => [doc.name.toUpperCase(), doc]))
