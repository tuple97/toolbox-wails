/**
 * 列悬停卡片：编辑器里悬停列名与结果表头悬停**共用**的一份 DOM 拼装。
 *
 * 抽成共享模块的理由：两处的信息（列名 / 类型 / 来源表 / 注释）与层次
 * （列名是主体，其余小一档、弱色）必须长得一样 —— 分开写迟早漂移。
 *
 * 层次规则（与结果表头、补全候选一致）：
 *  - 列名：正文字色 + 加粗 + 大一档字号，是卡片的主角；
 *  - 类型：等宽字体、弱色，跟在列名后面；
 *  - 来源表 / 注释：小字弱色，图标各带一种颜色做标识
 *    （来源表 = 品牌色、注释 = 琥珀色，与补全候选行的图标颜色同一套约定）。
 *
 * `surface` 选项控制是否自带浮层表面（底色 / 描边 / 阴影）：
 *  - 编辑器（CM tooltip）：不加 —— 底色由 CM 主题的 `.cm-tooltip` 提供；
 *  - 结果表头（#app-tip 富卡片模式）：加 —— 提示容器会让出表面。
 *
 * DOM 全部用 textContent 填充（图标是本模块的固定字符串），没有注入面。
 */

/** 「来源表」图标（表格轮廓，跟随文字颜色；补全候选行的来源段也用它） */
export const TABLE_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.6"/><path d="M2.2 6.6h11.6M6.6 6.6v6.2"/></svg>'

/** 「注释」图标（对话气泡；补全候选行的注释段也用它） */
export const COMMENT_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M3.4 3.4h9.2a1.6 1.6 0 0 1 1.6 1.6v4.6a1.6 1.6 0 0 1-1.6 1.6H7.2L4.4 13.6v-2.4H3.4a1.6 1.6 0 0 1-1.6-1.6V5a1.6 1.6 0 0 1 1.6-1.6Z"/></svg>'

/** 卡片展示的列信息（编辑器悬停与结果表头都给得出这几项） */
export interface ColumnHoverCardInfo {
  /** 列名（卡片的主体） */
  name: string
  /**
   * 字段类型（完整定义，如 varchar(32)）。
   *
   * 刻意叫 `dataType` 而不是 `type`：编辑器悬停的 `SqlColumnInfo` 与
   * 结果集元数据的口径都是它 —— 字段名对不上时 TypeScript 只会安静地
   * 丢掉这一行（可选属性可缺省），不会报错。
   */
  dataType?: string
  /** 来源表；派生列带 `derived` 时会标注 */
  table?: string
  /** 字段注释 / 描述 */
  comment?: string
  /** 该列来自派生表 / CTE 的静态解析 */
  derived?: boolean
}

export function buildColumnHoverCard(
  info: ColumnHoverCardInfo,
  options: { surface?: boolean } = {},
): HTMLElement {
  const root = document.createElement('div')
  root.className = options.surface ? 'column-hover column-hover--surface' : 'column-hover'

  const head = document.createElement('div')
  head.className = 'column-hover__head'

  const name = document.createElement('span')
  name.className = 'column-hover__name'
  name.textContent = info.name
  head.appendChild(name)

  if (info.dataType) {
    const type = document.createElement('span')
    type.className = 'column-hover__type'
    type.textContent = info.dataType
    head.appendChild(type)
  }

  root.appendChild(head)

  const rows: HTMLElement[] = []
  if (info.table) {
    rows.push(hoverRow('column-hover__icon--table', TABLE_ICON, info.derived ? `${info.table}（派生列）` : info.table))
  }
  if (info.comment) {
    rows.push(hoverRow('column-hover__icon--comment', COMMENT_ICON, info.comment))
  }
  if (rows.length) {
    const meta = document.createElement('div')
    meta.className = 'column-hover__meta'
    meta.append(...rows)
    root.appendChild(meta)
  }

  return root
}

/** 一行「图标 + 内容」；tone 决定图标的标识色（图标是固定字符串，不含用户输入） */
function hoverRow(tone: string, icon: string, value: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'column-hover__row'

  const glyph = document.createElement('span')
  glyph.className = `column-hover__icon ${tone}`
  glyph.innerHTML = icon
  row.appendChild(glyph)

  const text = document.createElement('span')
  text.className = 'column-hover__value'
  text.textContent = value
  row.appendChild(text)

  return row
}
