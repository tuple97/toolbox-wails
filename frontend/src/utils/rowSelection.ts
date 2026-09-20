/**
 * 表格行选择的规则（结果表格用）。
 *
 * 抽成纯函数的原因：这三条规则（普通点击 / Ctrl 加减选 / Shift 区间选）
 * 是「用户以为自己会用、但很容易写错」的交互 ——
 * 尤其是**反向 Shift**（锚点在下、点在上面）和「Shift 之后再 Shift」，
 * 手写很容易出现「选了个空区间」或「锚点被改掉导致区间跳来跳去」。
 *
 * 与桌面表格（Excel / Windows 资源管理器）的习惯保持一致：
 *  - 普通点击：只选这一行，并把它设为锚点；
 *  - Ctrl（macOS 为 Cmd）点击：切换这一行，并把它设为锚点；
 *  - Shift 点击：选中「锚点 ↔ 这一行」的**整个区间**（覆盖原选择，但保留锚点），
 *    这样连续 Shift 可以来回调整区间范围；
 *  - Shift 时还没有锚点：退化成普通点击。
 *
 * 返回的数组顺序即「选择顺序」：区间选择一律升序（从上到下），
 * Ctrl 加选保持加选的先后 —— 批量生成的 SQL 会按这个顺序排列，
 * 与用户看到的顺序一致才好对照。
 */

export interface RowSelectionInput {
  /** 当前已选行下标 */
  current: number[]
  /** 本次点击的行下标 */
  clicked: number
  /** 是否按住 Shift */
  shift: boolean
  /** 是否按住 Ctrl / Cmd */
  toggle: boolean
  /** 上一次操作留下的锚点（区间起点），没有则为 null */
  anchor: number | null
}

export interface RowSelectionResult {
  selected: number[]
  anchor: number
}

export function applyRowSelection(input: RowSelectionInput): RowSelectionResult {
  const { current, clicked, shift, toggle, anchor } = input

  // Shift：区间选择（反向也成立），锚点保持不动，便于连续调整
  if (shift && anchor !== null) {
    const from = Math.min(anchor, clicked)
    const to = Math.max(anchor, clicked)
    const range: number[] = []
    for (let index = from; index <= to; index++) {
      range.push(index)
    }
    return { selected: range, anchor }
  }

  // Ctrl / Cmd：切换单行，并把它设为新锚点
  if (toggle) {
    const selected = current.includes(clicked)
      ? current.filter(index => index !== clicked)
      : [...current, clicked]
    return { selected, anchor: clicked }
  }

  // 普通点击：只选这一行
  return { selected: [clicked], anchor: clicked }
}
