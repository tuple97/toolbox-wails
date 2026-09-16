/**
 * 模板块片段的「占位链」。
 *
 * 插入 `{{if }} … {{end}}` 骨架后，块头条件与块体各留一个占位：
 * 主光标停在第一个，按 Tab 依次跳到下一个，走完自动释放。
 *
 * 位置存在 `StateField` 里：随编辑自动漂移、不写进文档、不进撤销历史，
 * 也不需要任何「插入后再触发一次补全」的时序配合 —— 占位只是光标位置，
 * 候选照常由补全引擎按位置给出。
 */
import { StateEffect, StateField } from '@codemirror/state'
import type { EditorState, Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/** 设置（或清空，传 null）占位链 */
export const setTemplatePlaceholders = StateEffect.define<number[] | null>()

/** 占位位置（升序，文档坐标） */
const placeholderField = StateField.define<number[]>({
  create: () => [],

  update(positions, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setTemplatePlaceholders)) {
        return effect.value ? [...effect.value].sort((a, b) => a - b) : []
      }
    }
    if (!tr.docChanged) {
      return positions
    }
    // 编辑后位置跟着文档漂移，越界的丢掉（占位只描述"刚插入的那处"）
    return positions
      .map(pos => tr.changes.mapPos(pos, 1))
      .filter(pos => pos > 0 && pos <= tr.state.doc.length)
      .sort((a, b) => a - b)
  },
})

/** 占位链扩展（挂到编辑器即可；没有占位时就是空数组，零开销） */
export function templatePlaceholderExtension(): Extension {
  return placeholderField
}

/** 当前占位位置（升序） */
export function placeholderPositions(state: EditorState): number[] {
  return state.field(placeholderField, false) ?? []
}

/**
 * 跳到下一个占位。
 *
 * 没有占位、或已经走到最后一个时返回 false —— 交回默认的 Tab 行为（缩进），
 * 于是「Tab 在占位之间跳、跳完就正常缩进」是一条自然的链路。
 */
export function jumpToNextPlaceholder(view: EditorView): boolean {
  const positions = placeholderPositions(view.state)
  if (!positions.length) {
    return false
  }

  const head = view.state.selection.main.head
  const next = positions.find(pos => pos > head)
  if (next === undefined) {
    clearTemplatePlaceholders(view)
    return false
  }

  view.dispatch({ selection: { anchor: next }, scrollIntoView: true })
  return true
}

/** 清空占位链 */
export function clearTemplatePlaceholders(view: EditorView): void {
  if (!placeholderPositions(view.state).length) {
    return
  }
  view.dispatch({ effects: setTemplatePlaceholders.of(null) })
}
