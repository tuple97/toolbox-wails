import type { ColumnMeta, DictionaryItem, FieldMapping } from '@/types'

/** 单元格渲染结果 */
export interface CellRenderResult {
  /** 最终展示文本 */
  text: string
  /** 悬浮提示，通常为词典项的描述 */
  tooltip: string
  /** 是否命中词典 */
  matched: boolean
  /** 原始值 */
  raw: string
}

/** 单元格展示模板中支持的占位符 */
const VALUE_TOKEN = /\{\{\s*value\s*\}\}/g
const MEANING_TOKEN = /\{\{\s*meaning\s*\}\}/g
const DESC_TOKEN = /\{\{\s*description\s*\}\}/g

/**
 * 把原始值转为展示文本。
 *
 * 渲染优先级：
 *   1. 命中词典 → 按模板渲染（默认使用 meaning）
 *   2. 未命中词典 → 展示原始值
 *   3. 值为空 → 展示占位符 '-'
 *
 * @param value       单元格原始值
 * @param mapping     该列的映射配置
 * @param lookupFn    词典查询函数，由 dictStore 提供
 */
export function formatCell(
  value: unknown,
  mapping: FieldMapping | undefined,
  lookupFn: (dictionaryId: number, value: unknown) => DictionaryItem | undefined,
): CellRenderResult {
  const raw = value === null || value === undefined ? '' : String(value)

  if (raw === '') {
    return { text: '-', tooltip: '', matched: false, raw }
  }

  const dictionaryId = mapping?.dictionaryId
  if (!dictionaryId) {
    return { text: raw, tooltip: '', matched: false, raw }
  }

  const item = lookupFn(dictionaryId, value)
  if (!item) {
    // 未命中时保留原始值，便于用户发现词典遗漏的取值
    return { text: raw, tooltip: '未在词典中找到该值', matched: false, raw }
  }

  const context = {
    value: raw,
    meaning: item.meaning,
    description: item.description ?? '',
  }

  const template = mapping?.template?.trim()
  const text = template
    ? renderTemplate(template, context)
    : item.meaning

  return {
    text,
    tooltip: item.description || item.meaning,
    matched: true,
    raw,
  }
}

/**
 * 渲染展示模板。
 * 支持 {{value}}、{{meaning}}、{{description}} 三种占位符。
 */
export function renderTemplate(
  template: string,
  context: { value: string, meaning: string, description: string },
): string {
  return template
    .replace(VALUE_TOKEN, context.value)
    .replace(MEANING_TOKEN, context.meaning)
    .replace(DESC_TOKEN, context.description)
}

/**
 * 生成结果表格的列定义。
 *
 * 依据映射配置决定列顺序、别名、宽度与对齐；
 * 未被映射的列追加在后面，保证结果集不会丢列。
 */
export function buildColumns(
  columns: ColumnMeta[],
  mappings: FieldMapping[],
): Array<{ column: string, label: string, width?: number, align: 'left' | 'center' | 'right', type: string }> {
  const names = columns.map(c => c.name)
  const typeOf = new Map(columns.map(c => [c.name, c.type]))
  const mapped = new Map(mappings.map(m => [m.column, m]))

  const result: Array<{
    column: string
    label: string
    width?: number
    align: 'left' | 'center' | 'right'
    type: string
  }> = []

  // 已配置映射的列，按配置顺序优先展示
  for (const mapping of mappings) {
    if (!names.includes(mapping.column)) {
      continue
    }
    result.push({
      column: mapping.column,
      label: mapping.label || mapping.column,
      width: mapping.width,
      align: mapping.align ?? 'left',
      type: typeOf.get(mapping.column) ?? '',
    })
  }

  // 未配置映射的列，按结果集原始顺序补充
  for (const name of names) {
    if (mapped.has(name)) {
      continue
    }
    result.push({ column: name, label: name, align: 'left', type: typeOf.get(name) ?? '' })
  }

  return result
}

/**
 * 创建按列查询映射配置的辅助函数，
 * 避免在表格渲染时对每行每列重复遍历数组。
 */
export function createMappingLookup(
  mappings: FieldMapping[],
): (column: string) => FieldMapping | undefined {
  const map = new Map(mappings.map(m => [m.column, m]))
  return (column: string) => map.get(column)
}
