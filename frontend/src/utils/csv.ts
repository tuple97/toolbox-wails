/**
 * CSV 生成（结果表格「Ctrl+C 复制为 CSV」用）。
 *
 * 按 RFC 4180 的转义规则来：**只有当字段里出现逗号、引号或换行时**才加引号，
 * 引号本身翻倍。不做「一律加引号」是因为那样粘到 Excel / 编辑器里到处是引号，
 * 肉眼比对数据时很难受。
 */

/** 字段里出现这些字符就必须加引号（逗号与换行会破坏列/行结构，引号要转义） */
const MUST_QUOTE = /[",\r\n]/

/**
 * 单元格值 → CSV 字段文本。
 *
 * 空值给空串（而不是 `null` 字样）：Excel 与数据库工具都这样约定，
 * 写成字面量 `null` 反而会被当成字符串。
 */
export function csvCellText(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'object') {
    // 结果集里出现对象（如 JSON 列、复合类型）时给 JSON：总比 "[object Object]" 有用
    try {
      return JSON.stringify(value)
    }
    catch {
      return String(value)
    }
  }
  return String(value)
}

/** 单个字段的转义 */
export function escapeCsvField(text: string): string {
  return MUST_QUOTE.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * 生成 CSV 文本（含表头）。
 *
 * 行尾用 `\r\n`：这是 RFC 4180 的规定，也是 Excel 最不容易出错的选择。
 * 不追加末尾换行 —— 多了会在粘贴时留一个空行。
 */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [
    headers.map(header => escapeCsvField(csvCellText(header))).join(','),
    ...rows.map(row => row.map(cell => escapeCsvField(csvCellText(cell))).join(',')),
  ]
  return lines.join('\r\n')
}
