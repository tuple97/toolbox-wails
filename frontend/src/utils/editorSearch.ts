/**
 * 编辑器的查找 / 替换能力（`@codemirror/search`）。
 *
 * 单独成一个模块（而不是散在 CodeEditor 里）的两个理由：
 *  1. 查找是**所有编辑器共用**的基础能力（SQL 编辑器、模板编辑器、日志视图都走同一个
 *     组件），与 SQL 语义那一堆扩展不是一类东西；
 *  2. 逻辑虽薄，要点却不少（面板位置、命中高亮、选中词同名高亮、快捷键、深色主题下的
 *     可读性），抽出来就能对着**真实 EditorView** 写用例，而不是靠人肉点界面。
 *
 * 面板视觉（`.cm-panel.cm-search` / `.cm-searchMatch` / `.cm-selectionMatch`）在
 * `utils/logLanguage.ts` 的主题里覆盖：官方默认样式是浅色硬编码，深色主题下会糊成一片。
 */
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import type { Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import type { EditorView } from '@codemirror/view'

/**
 * 查找能力要注册的扩展。
 *
 * 三件事：
 *  - `search({ top: true })`：面板固定在编辑器**顶部** —— 放底部会被结果区、日志面板
 *    以及补全浮层挤掉；
 *  - `highlightSelectionMatches()`：选中一个词（比如别名、表名）时，文中其它出现处
 *    一起高亮。SQL 里「这个词还在哪儿用过」是最常问的问题，比查找更顺手；
 *  - `searchKeymap`：Ctrl+F 打开面板、F3 / Ctrl+G 上下一个、**Ctrl+D 选中同名单词**
 *    （多光标，`allowMultipleSelections` 已开）、Ctrl+Shift+L 选中全部同名。
 *    这些是官方默认键位，不再自己另立一套。
 */
export function editorSearchExtensions(): Extension[] {
  return [
    search({ top: true }),
    highlightSelectionMatches(),
    keymap.of([...searchKeymap]),
  ]
}

/**
 * 打开查找 / 替换面板（右键菜单入口）。
 *
 * 官方实现会同时把焦点交给搜索框，所以调用方不需要自己摸 DOM 去 focus ——
 * 这正是「右键点进来就能直接打字」的关键。
 */
export function openEditorSearch(view: EditorView): boolean {
  return openSearchPanel(view)
}
