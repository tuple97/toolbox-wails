/**
 * 浮层定位（下拉 / 选择器的 Teleport 浮层用）。
 *
 * 抽成公共件的原因：`Combobox` 与 `MultiSelect` 的浮层行为必须**完全一致** ——
 * 位置算法、向上翻转、跟随滚动这些细节一旦两处各写一份，迟早出现
 * 「单选的下拉会翻上去、多选的不翻」这种说不清的差异。
 *
 * 做法（与 `ContextMenu.vue` 同一套）：以触发器矩形为基准 fixed 定位，
 * 下方放不下且上方更宽敞时向上翻转；宽度与触发器等宽。
 */
import { nextTick, ref } from 'vue'
import type { Ref } from 'vue'

export interface PopoverPosition {
  left: number
  top: number
  width: number
}

export interface PopoverAnchorOptions {
  /** 浮层与触发器之间的间隙 */
  gap?: number
  /** 浮层最大高度（用于判断「下方还放得下吗」，与样式里的 max-height 保持一致） */
  maxHeight?: number
}

export function usePopoverAnchor(
  trigger: Ref<HTMLElement | null>,
  panel: Ref<HTMLElement | null>,
  options: PopoverAnchorOptions = {},
) {
  const gap = options.gap ?? 4
  const maxHeight = options.maxHeight ?? 256

  /** 浮层位置（配合 `position: fixed` 使用） */
  const position = ref<PopoverPosition>({ left: 0, top: 0, width: 0 })

  /**
   * 重新计算位置。
   *
   * `refine`：浮层高度要渲染后才量得到，首帧按最大高度估算，渲染完再修正一次
   * （只修正一次，避免布局抖动时来回算）。
   */
  async function update(refine = true) {
    const el = trigger.value
    if (!el) {
      return
    }
    const rect = el.getBoundingClientRect()
    const height = Math.min(panel.value?.offsetHeight || maxHeight, maxHeight)
    const below = window.innerHeight - rect.bottom - gap
    // 下方放不下、且上方更宽敞 → 向上弹
    const up = below < height && rect.top - gap > below
    position.value = {
      left: rect.left,
      width: rect.width,
      top: up ? Math.max(gap, rect.top - gap - height) : rect.bottom + gap,
    }
    if (refine) {
      await nextTick()
      await update(false)
    }
  }

  /** 视口变化（含任意祖先容器滚动）时跟着挪：capture 才能收到内层滚动 */
  function handleViewportChange() {
    void update(false)
  }

  function bind() {
    window.addEventListener('scroll', handleViewportChange, true)
    window.addEventListener('resize', handleViewportChange)
  }

  function unbind() {
    window.removeEventListener('scroll', handleViewportChange, true)
    window.removeEventListener('resize', handleViewportChange)
  }

  return { position, update, bind, unbind }
}
