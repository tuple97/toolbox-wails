/**
 * 模板占位链用例：位置随编辑漂移、Tab 依次跳转、走完自动释放。
 */
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import type { EditorView } from '@codemirror/view'
import {
  jumpToNextPlaceholder,
  placeholderPositions,
  setTemplatePlaceholders,
  templatePlaceholderExtension,
} from '@/utils/sql/template/templatePlaceholder'

/** 建一个带占位链扩展的编辑器状态 */
function stateOf(doc: string, placeholders: number[] = []) {
  const base = EditorState.create({ doc, extensions: [templatePlaceholderExtension()] })
  return placeholders.length
    ? base.update({ effects: setTemplatePlaceholders.of(placeholders) }).state
    : base
}

/** 假视图：接住 dispatch 并更新自己的 state */
function viewOf(state: EditorState) {
  const view = {
    state,
    dispatch(spec: { selection?: { anchor: number }, effects?: unknown, changes?: unknown }) {
      const effects = spec.effects ? [spec.effects] : []
      const changes = spec.changes as Parameters<EditorState['update']>[0]['changes']
      const selection = spec.selection
      const next = view.state.update({ changes, selection, effects: effects as never })
      view.state = next.state
    },
  } as unknown as { state: EditorState, dispatch: (spec: unknown) => void } & EditorView
  return view
}

describe('模板占位链', () => {
  it('登记后可以读出位置（升序）', () => {
    expect(placeholderPositions(stateOf('{{if }}\n\n{{end}}', [14, 7]))).toEqual([7, 14])
  })

  it('未登记时为空', () => {
    expect(placeholderPositions(stateOf('plain'))).toEqual([])
  })

  it('Tab 依次跳转，最后释放占位', () => {
    const view = viewOf(stateOf('{{if }}\n  \n{{end}}', [5, 10]))
    view.dispatch({ selection: { anchor: 0 } })

    expect(jumpToNextPlaceholder(view)).toBe(true)
    expect(view.state.selection.main.head).toBe(5)

    expect(jumpToNextPlaceholder(view)).toBe(true)
    expect(view.state.selection.main.head).toBe(10)

    // 走完最后一个：返回 false（Tab 交回默认缩进），并清空占位
    expect(jumpToNextPlaceholder(view)).toBe(false)
    expect(placeholderPositions(view.state)).toEqual([])
  })

  it('没有占位时不消费 Tab', () => {
    const view = viewOf(stateOf('plain'))
    expect(jumpToNextPlaceholder(view)).toBe(false)
  })

  it('位置随编辑漂移：在光标前插入文本后占位一并后移', () => {
    const state = stateOf('ab', [2])
    const moved = state.update({ changes: { from: 0, insert: 'XY' } }).state
    expect(placeholderPositions(moved)).toEqual([4])
  })

  it('文档变短时占位移到新的末尾', () => {
    const state = stateOf('abcdef', [6])
    const shrunk = state.update({ changes: { from: 0, to: 6, insert: 'a' } }).state
    // 原来的位置被删除覆盖，映射到新文档的末尾（占位只描述「刚插入的那处」）
    expect(placeholderPositions(shrunk)).toEqual([1])
  })
})
