/**
 * 表格列布局与取值（`components/ui/DataTable.vue` 的纯逻辑部分）。
 *
 * 抽出来是因为这是表格里最容易算错、也最值得单独验证的一段：
 * 「固定宽度的列拿定值，其余列按 minWidth 比例分剩余空间」——
 * 之前用 Element Plus 时这段在它内部，出了问题只能靠眼睛看；
 * 现在它是纯函数，用例直接锁住（见 tableLayout.spec.ts）。
 */

export interface TableColumn {
  /** 列键：取 `row[key]`，也用来组插槽名 `cell-<key>` / `header-<key>` */
  key: string
  label: string
  /** 固定宽度（px） */
  width?: number
  /** 弹性列的最小宽度：决定分剩余空间时的权重 */
  minWidth?: number
  align?: 'left' | 'center' | 'right'
  /** 内容超出时截断，并给一个悬停看全文的提示 */
  ellipsis?: boolean
}

/** 弹性列的默认权重（没写 minWidth 时） */
export const DEFAULT_MIN_WIDTH = 120

/** 弹性列的权重总和；全为固定宽度时返回 0 */
export function flexWeightOf(columns: TableColumn[]): number {
  return columns.reduce((sum, column) => sum + (column.width ? 0 : column.minWidth ?? DEFAULT_MIN_WIDTH), 0)
}

/**
 * 该列的内联宽度样式。
 *
 * 固定宽度列按像素；弹性列按权重占剩余空间的百分比。
 * 全部列都是固定宽度时返回空对象 —— 交给浏览器按内容分配，不要写一个假的百分比。
 */
export function columnWidthStyle(
  column: TableColumn,
  columns: TableColumn[],
): Record<string, string> {
  if (column.width) {
    return { width: `${column.width}px` }
  }
  const total = flexWeightOf(columns)
  if (total <= 0) {
    return {}
  }
  const weight = column.minWidth ?? DEFAULT_MIN_WIDTH
  return { width: `${(weight / total) * 100}%` }
}

/**
 * 表格的**最小总宽度**（px）：各列「固定宽度或最小宽度」之和。
 *
 * 这是「列太多时横向滚动」的关键：表格宽度取 `max(容器宽度, 它)`。
 * 只写 `width: 100%` 的话，列会被无限压缩去凑容器宽度 ——
 * 列一多就全挤在一起，文字被截成一条缝（这正是自绘表格最初漏掉的行为）。
 */
export function tableMinWidthOf(columns: TableColumn[], indexWidth = 0): number {
  const total = columns.reduce(
    (sum, column) => sum + (column.width ?? column.minWidth ?? DEFAULT_MIN_WIDTH),
    0,
  )
  return total + indexWidth
}

/** 对齐 → Tailwind 文本对齐类 */
export function alignClassOf(column: TableColumn): string {
  if (column.align === 'center') {
    return 'text-center'
  }
  return column.align === 'right' ? 'text-right' : 'text-left'
}

/** 单元格文本：`null` / `undefined` 一律显示为空串（不要显示成 "null"） */
export function cellTextOf(row: Record<string, unknown>, column: TableColumn): string {
  const value = row[column.key]
  return value === null || value === undefined ? '' : String(value)
}
