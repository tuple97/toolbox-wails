/**
 * 应用自己的小提示，用来替代原生 `title`。
 *
 * 为什么做全局代理而不是逐个改调用点：
 *  - 原生 title 的样式完全由系统决定（白底方框），与应用的浮层观感不一致，
 *    且 CSS 无法干预；
 *  - 全项目有几十处 `title`（含动态 `:title`），逐个换成 el-tooltip 既啰嗦，
 *    也容易在列表/拖拽项里引入定位问题。
 *
 * 机制：指针进入带 `title` 的元素时，把文案暂存到 `data-app-tip` 并**移除 title**
 * （这样系统提示不会再弹出），延时后显示 `#app-tip`；指针离开时恢复 title，
 * 保证语义与无障碍信息不丢。样式见 styles/global.css 的 `#app-tip`。
 */
import { buildColumnHoverCard } from '@/utils/sql/columnHoverCard'

/** 显示延时（毫秒）：太短会划过就闪，太长会显得迟钝 */
const SHOW_DELAY = 400
/** 小提示元素 id（样式在 global.css） */
const TIP_ID = 'app-tip'
/** 暂存原生提示文案的属性名 */
const STASH_ATTR = 'data-app-tip'
/**
 * 富卡片模式：元素带 `data-col-name` 时显示「列悬停卡片」（列名 / 类型 /
 * 来源表 / 描述，见 utils/sql/columnHoverCard.ts），其余数据用
 * `data-col-type` / `data-col-table` / `data-col-comment` 带上。
 * 结果表头用它 —— 纯文本 title 表达不了「列名大、其余小、图标带色」的层次。
 */
const CARD_ATTR = 'data-col-name'
/** 富卡片模式下加在小提示容器上的类（让出表面，卡片自带） */
const CARD_CLASS = 'app-tip--card'

let tip: HTMLDivElement | null = null
let timer: number | null = null
/** 当前正在提示的元素 */
let current: HTMLElement | null = null

/** 懒创建小提示元素（挂到 body，避免被容器 overflow 裁切） */
function ensureTip(): HTMLDivElement {
  if (tip) {
    return tip
  }
  tip = document.createElement('div')
  tip.id = TIP_ID
  tip.setAttribute('role', 'tooltip')
  tip.hidden = true
  document.body.appendChild(tip)
  return tip
}

/** 收起小提示，并把 title 还给元素 */
function hide() {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
  if (current) {
    const text = current.getAttribute(STASH_ATTR)
    if (text !== null) {
      current.setAttribute('title', text)
      current.removeAttribute(STASH_ATTR)
    }
    current = null
  }
  tip?.classList.remove(CARD_CLASS)
  tip?.setAttribute('hidden', '')
}

/** 把提示摆到元素下方（空间不够就翻到上方），并避免超出窗口左右边界 */
function place(el: HTMLElement) {
  const node = ensureTip()
  const rect = el.getBoundingClientRect()
  const width = node.offsetWidth
  const height = node.offsetHeight
  const margin = 8

  const left = Math.min(
    Math.max(margin, rect.left + rect.width / 2 - width / 2),
    window.innerWidth - width - margin,
  )
  const below = rect.bottom + margin
  const top = below + height > window.innerHeight ? rect.top - height - margin : below

  node.style.left = `${Math.round(left)}px`
  node.style.top = `${Math.round(Math.max(margin, top))}px`
}

/** 显示提示 */
function show(el: HTMLElement) {
  const node = ensureTip()
  node.textContent = el.getAttribute(STASH_ATTR) ?? ''
  node.hidden = false
  // 文本渲染后才知道真实尺寸，摆一次再校正一次
  place(el)
  requestAnimationFrame(() => {
    if (current === el) {
      place(el)
    }
  })
}

/** 显示列悬停卡片（富卡片模式；数据来自元素上的 data-col-* 属性） */
function showCard(el: HTMLElement) {
  const node = ensureTip()
  const name = el.dataset.colName
  if (!name) {
    return
  }
  node.classList.add(CARD_CLASS)
  node.replaceChildren(
    buildColumnHoverCard({
      name,
      dataType: el.dataset.colType || undefined,
      table: el.dataset.colTable || undefined,
      comment: el.dataset.colComment || undefined,
    }, { surface: true }),
  )
  node.hidden = false
  place(el)
  requestAnimationFrame(() => {
    if (current === el) {
      place(el)
    }
  })
}

/**
 * 安装全局代理（在应用挂载后调用一次即可）。
 *
 * 用捕获阶段的 pointerover/pointerout：能覆盖动态插入的元素，
 * 也不影响任何组件自身的鼠标交互。
 */
export function installTitleTooltip() {
  document.addEventListener('pointerover', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }

    /*
     * 两种提示取**离目标最近**的那个：卡片区域里嵌着带 title 的小元素时
     * （如主键图标的「主键」），就近的 title 赢，不至于被卡片盖掉。
     */
    const el = target.closest<HTMLElement>(`[${CARD_ATTR}], [title]`)
    if (!el || el === current) {
      return
    }

    if (el.hasAttribute(CARD_ATTR)) {
      hide()
      current = el
      timer = window.setTimeout(() => {
        if (current === el) {
          showCard(el)
        }
      }, SHOW_DELAY)
      return
    }

    const text = el.getAttribute('title')?.trim()
    if (!text) {
      return
    }

    hide()
    el.setAttribute(STASH_ATTR, text)
    // 移除 title：系统提示不会再生效
    el.removeAttribute('title')
    current = el
    timer = window.setTimeout(() => {
      if (current === el) {
        show(el)
      }
    }, SHOW_DELAY)
  }, true)

  document.addEventListener('pointerout', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }

    const el = target.closest<HTMLElement>(`[${STASH_ATTR}],[${CARD_ATTR}]`)
    if (!el || el !== current) {
      return
    }

    // 只是移到了自己的子元素上：不算离开
    const related = event.relatedTarget
    if (related instanceof Node && el.contains(related)) {
      return
    }
    hide()
  }, true)

  // 滚动 / 按下鼠标 / 窗口失焦时立即收起，避免提示停在原地
  window.addEventListener('scroll', hide, true)
  window.addEventListener('pointerdown', hide, true)
  window.addEventListener('blur', hide)
}
