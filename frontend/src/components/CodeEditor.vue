<script setup lang="ts">
/**
 * CodeMirror 6 编辑器封装（替代 Monaco）。
 *
 * 设计要点：
 *  - 实例必须放 shallowRef：CM6 view 内部结构庞大，放进普通 ref 会被深层代理，
 *    调用开销极高（与 Monaco 同一条铁律）；
 *  - 语言 / 主题 / 只读 / 字体各自用 Compartment：切换时 dispatch 一个新配置即可，
 *    不销毁重建编辑器（重建会丢滚动位置与撤销栈）；
 *  - 主题的两层分工见 utils/logLanguage.ts：
 *    EditorView.theme 管渲染层，HighlightStyle 管语法高亮层；
 *  - SQL 补全源由 utils/sqlCompletion.ts 提供（per-editor，靠 registerCompletionContext
 *    登记上下文；其它编辑器没登记就退化为空结果）。
 */
import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { Compartment, EditorState } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completeAnyWord,
  completeFromList,
  completionStatus,
  selectedCompletion,
} from '@codemirror/autocomplete'
import type { Completion, CompletionSource } from '@codemirror/autocomplete'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { MySQL, PostgreSQL, sql } from '@codemirror/lang-sql'
import type { SQLDialect } from '@codemirror/lang-sql'
import { javascript, localCompletionSource, snippets } from '@codemirror/lang-javascript'
import { useConfigStore } from '@/stores/configStore'
import { createSqlCompletion, isColumnMarked, toggleColumnMark } from '@/utils/sqlCompletion'
import { createStatementBoxExtension } from '@/utils/sqlStatementBox'
import { sqlStatementRunGutter, type RunnableStatement } from '@/utils/sqlRunGutter'
import {
  LOG_LANGUAGE_ID,
  editorThemeExtensions,
  editorThemeNameOf,
  logLanguage,
} from '@/utils/logLanguage'

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'change', value: string): void
  /** 编辑器实例就绪（用于登记补全上下文等实例级能力） */
  (e: 'mount', view: EditorView): void
  /**
   * 光标 / 选区变化（无载荷）。
   *
   * 编辑器状态不是响应式对象，调用方拿不到「当前选中的是哪段 SQL」的变化时机；
   * 这里只发一个信号，由调用方重新读自己的最新状态即可。
   */
  (e: 'selection'): void
  /** 点击语句左侧的运行按钮（把该语句交给调用方执行） */
  (e: 'run-statement', statement: RunnableStatement): void
}>()

const props = withDefaults(defineProps<{
  /** 编辑内容（v-model） */
  modelValue: string
  /** 语言：sql / javascript / toolbox-log（执行记录） */
  language?: string
  /**
   * 数据库类型（mysql / postgres…），决定 SQL 方言。
   * 方言影响 Lezer 语法树的词法：默认（标准 SQL）会把 MySQL 的反引号标识符
   * 判成错误节点，语法树与补全的作用域分析都会变差。
   */
  dbType?: string
  /** 主题名（应用主题键，如 toolbox-dark）；留空时跟随全局配置 */
  theme?: string
  /** 是否只读 */
  readonly?: boolean
  /** 编辑器高度 */
  height?: string
  /** 是否显示行号 */
  showLineNumbers?: boolean
  /** 是否关闭智能提示（日志展示场景） */
  disableSuggestions?: boolean
  /** 是否给识别出的每条 SQL 套边框（仅 sql 语言生效，命令执行器用） */
  showStatementFrames?: boolean
  /** 是否在行号左侧显示「执行这条语句」按钮（仅 sql 语言生效，命令执行器用） */
  showRunButtons?: boolean
}>(), {
  language: 'sql',
  theme: '',
  readonly: false,
  height: '260px',
  showLineNumbers: true,
  disableSuggestions: false,
  showStatementFrames: false,
  showRunButtons: false,
})

const configStore = useConfigStore()

/** 编辑器实例（重量级对象：必须 shallowRef） */
const viewRef = shallowRef<EditorView | null>(null)
const host = shallowRef<HTMLDivElement | null>(null)

/** 各维度独立 Compartment，便于运行时重配置 */
const languageCompartment = new Compartment()
const themeCompartment = new Compartment()
const readOnlyCompartment = new Compartment()
const fontCompartment = new Compartment()

// ---------------------------------------------------------------- 各层扩展

/** 连接类型 → Lezer SQL 方言；未知类型返回 undefined（用标准 SQL） */
function sqlDialectOf(dbType: string): SQLDialect | undefined {
  switch (dbType.toLowerCase()) {
    case 'mysql':
      return MySQL
    case 'postgres':
    case 'postgresql':
      return PostgreSQL
    default:
      return undefined
  }
}

/** 语言扩展：SQL / JavaScript / 日志（未知语言按纯文本处理） */
function languageExtension(): Extension {
  switch (props.language) {
    case 'sql':
      return sql({ dialect: sqlDialectOf(props.dbType ?? '') })
    case 'javascript':
      return javascript()
    case LOG_LANGUAGE_ID:
      return logLanguage()
    default:
      return []
  }
}

/** 当前生效的编辑器主题名：显式传入优先，否则跟随全局主题 */
function themeName(): string {
  if (props.theme) {
    return props.theme
  }
  return editorThemeNameOf(configStore.theme)
}

/** 字体与字号跟随「设置 → 编辑器字体 / 编辑器字号」 */
function fontExtension(): Extension {
  const fontFamily = configStore.editorFontStack
  return EditorView.theme({
    '&': { fontSize: `${configStore.editorFontSize}px` },
    '.cm-scroller': {
      fontFamily,
      lineHeight: '1.6',
    },
    /*
     * 补全/悬停浮层也用编辑器字体。
     * 浮层是 .cm-editor 的子元素、不在 .cm-scroller 内，只写 .cm-scroller
     * 的话它会回退成界面字体（Inter/雅黑），和代码字体不一致。
     */
    '.cm-tooltip': {
      fontFamily,
    },
  })
}

/** 只读：同时禁编辑与禁光标输入行为 */
function readOnlyExtension(): Extension {
  return props.readonly
    ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
    : []
}

/**
 * 补全源组装。
 *
 * 注意 `override` 会**替换掉语言自带的所有补全源**，因此必须把需要的都显式列上：
 *  - SQL：项目自己的元数据补全源（未登记连接上下文的编辑器——如 SQL 模板——
 *    会退化为「关键字 + 函数」，见 utils/sqlCompletion.ts）；
 *  - JavaScript：lang-javascript 自带的片段/关键字与作用域内标识符补全，
 *    另外补上「文档内单词」。
 *
 * SQL **不挂「文档内单词」**：它会把文档里出现过的词整篇倒出来，
 * 而 SQL 编辑器里最不缺的单词就是列名——于是 `FROM ` 后面会冒出 SELECT
 * 列表里的列名，把表名候选挤掉。SQL 的候选一律由元数据补全源按子句产出。
 */
function completionSources(): CompletionSource[] {
  const sources: CompletionSource[] = []

  if (props.language === 'sql') {
    sources.push(createSqlCompletion(() => viewRef.value))
  }
  if (props.language === 'javascript') {
    sources.push(completeFromList([...snippets]))
    sources.push(localCompletionSource)
    sources.push(completeAnyWord)
  }

  return sources
}

/** 智能提示（日志等只读场景可用 disableSuggestions 关闭） */
function completionExtension(): Extension {
  if (props.disableSuggestions) {
    return []
  }
  const sources = completionSources()
  if (!sources.length) {
    return []
  }
  return autocompletion({
    override: sources,
    maxRenderedOptions: 50,
    /*
     * 打开列表即高亮第一项（CM6 默认 false）。
     * 默认行为下「刚弹出列表时按回车」会因为没有任何高亮项而落到
     * defaultKeymap 的换行上，体验上就是「回车不选中而是换行」。
     */
    selectOnOpen: true,
    /*
     * 不要关掉 defaultKeymap：CM6 内部的补全快捷键是通过
     * `Prec.highest` 注册的（Enter 接受、Esc 关闭、方向键选择），
     * 关掉之后 Enter 会被 defaultKeymap 的换行抢走。
     */
    defaultKeymap: true,
    /*
     * 关掉 CM6 默认的类型图标（那些 c / f / λ 之类的字母）。
     * 列表里已经有列名勾选框，再叠一串图标显得吵，也和「克制」的观感不符；
     * 类型信息由每项后面的 detail 文本承担。
     */
    icons: false,
    // 列名候选项左侧的勾选框（多选支持，见 renderColumnCheckbox）
    addToOptions: [{ render: renderColumnCheckbox, position: 10 }],
  })
}

// ---------------------------------------------------------------- 列名勾选

/**
 * 勾选框 DOM 缓存（label → 元素）。
 *
 * 空格切换勾选时直接改这个元素的 data 属性，不重新查询补全源——
 * 后者会重建整份候选列表、把高亮位置和勾选状态一起清掉。
 */
const checkNodes = new WeakMap<EditorView, Map<string, HTMLElement>>()

function setCheckState(el: HTMLElement, checked: boolean) {
  el.dataset.checked = checked ? 'true' : 'false'
}

/**
 * 在列名候选项最左侧渲染勾选框（其它类型不渲染）。
 * position 10 排在默认内容之前（CM6 内置：icon 20 / label 50 / detail 80）。
 */
function renderColumnCheckbox(
  completion: Completion,
  _state: EditorState,
  view: EditorView,
): Node | null {
  if (props.language !== 'sql' || completion.type !== 'field') {
    return null
  }

  const box = view.dom.ownerDocument.createElement('span')
  box.className = 'cm-sqlcheck'
  box.setAttribute('aria-hidden', 'true')
  setCheckState(box, isColumnMarked(view, completion.label))

  let nodes = checkNodes.get(view)
  if (!nodes) {
    nodes = new Map()
    checkNodes.set(view, nodes)
  }
  nodes.set(completion.label, box)
  return box
}

/**
 * 空格：勾选 / 取消勾选当前高亮的列名。
 *
 * 只有「补全列表打开且高亮项是列名」时才消费按键，其余情况返回 false，
 * 空格照常输入。勾选后回车会一次性插入所有勾选项（见 utils/sqlCompletion.ts）。
 */
function toggleCheckedColumn(view: EditorView): boolean {
  if (completionStatus(view.state) !== 'active') {
    return false
  }
  const completion = selectedCompletion(view.state)
  if (!completion || completion.type !== 'field') {
    return false
  }

  const checked = toggleColumnMark(view, completion.label)
  const box = checkNodes.get(view)?.get(completion.label)
  if (box) {
    setCheckState(box, checked)
  }
  return true
}

/** 与编辑器无关的基础能力（行号、历史、括号、快捷键等） */
function baseExtensions(): Extension[] {
  const extensions: Extension[] = [
    highlightSpecialChars(),
    history(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    EditorState.tabSize.of(2),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    // 超长行自动折行（与原 Monaco 配置的 wordWrap: 'on' 保持一致）
    EditorView.lineWrapping,
    /*
     * tabindex 必须显式给：CM6 在只读（editable=false）时会把 .cm-content 设成
     * contentEditable="false"，浏览器就不会因为点击而聚焦它 —— 于是按键（Ctrl+A 全选、
     * Ctrl+C 复制）落不到编辑器上，只有鼠标划选能用（那是 CM 自己实现的）。
     * 加上 tabindex 后只读编辑器也能获得焦点，CM 自带的 Mod-a / 复制与我们的快捷键才生效。
     */
    EditorView.contentAttributes.of({ spellcheck: 'false', tabindex: '0' }),
    // 补全快捷键由 autocompletion 自己以 Prec.highest 注册（见 completionExtension），
    // 这里不要再重复绑定 completionKeymap；只补一个它没有的「空格勾选列名」
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      { key: 'Space', run: toggleCheckedColumn },
      indentWithTab,
    ]),
    EditorView.updateListener.of(handleUpdate),
  ]

  /*
   * 语句运行按钮：每条语句左侧一个 ▶，点击执行它；执行中/成功/失败会换成对应图标。
   * 必须排在行号 gutter 之前，才显示在行号左边（gutter 按扩展顺序排列）。
   */
  if (props.showRunButtons && props.language === 'sql') {
    extensions.push(sqlStatementRunGutter({
      dbType: () => props.dbType ?? '',
      onRun: statement => emit('run-statement', statement),
    }))
  }

  if (props.showLineNumbers) {
    extensions.push(lineNumbers(), highlightActiveLineGutter())
  }

  /*
   * 语句边框：光标所在语句的一个整框（见 utils/sqlStatementBox.ts）。
   * 用 CM 自己的 layer 绘制，滚动/改窗口/软换行重排都由 CM 驱动重绘，
   * 语句范围按连接方言切分（分号或行首关键字分隔）。
   */
  if (props.showStatementFrames && props.language === 'sql') {
    extensions.push(createStatementBoxExtension(() => props.dbType ?? ''))
  }

  return extensions
}

/** 文档变化 → 回抛 v-model（程序化写入不回抛，避免冗余响应链） */
function handleUpdate(update: ViewUpdate) {
  // 先播报光标/选区变化：调用方据此重算「当前操作的是哪段 SQL」
  if (update.selectionSet || update.docChanged) {
    emit('selection')
  }
  if (!update.docChanged || props.readonly) {
    return
  }
  const value = update.state.doc.toString()
  if (value === props.modelValue) {
    return
  }
  emit('update:modelValue', value)
  emit('change', value)
}

// ---------------------------------------------------------------- 生命周期

onMounted(() => {
  const parent = host.value
  if (!parent) {
    return
  }

  const state = EditorState.create({
    doc: props.modelValue,
    extensions: [
      ...baseExtensions(),
      completionExtension(),
      languageCompartment.of(languageExtension()),
      themeCompartment.of(editorThemeExtensions(themeName())),
      readOnlyCompartment.of(readOnlyExtension()),
      fontCompartment.of(fontExtension()),
    ],
  })

  const view = new EditorView({ state, parent })
  viewRef.value = view
  emit('mount', view)
})

onBeforeUnmount(() => {
  // 重量级实例必须显式销毁
  viewRef.value?.destroy()
  viewRef.value = null
})

// ---------------------------------------------------------------- 响应式同步

/** 外部写入（父组件 setValue / 切换标签恢复内容） */
watch(() => props.modelValue, (value) => {
  const view = viewRef.value
  if (!view || value === view.state.doc.toString()) {
    return
  }
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
  })
})

watch([() => props.language, () => props.dbType], () => {
  viewRef.value?.dispatch({
    effects: languageCompartment.reconfigure(languageExtension()),
  })
})

watch([() => props.theme, () => configStore.theme], () => {
  viewRef.value?.dispatch({
    effects: themeCompartment.reconfigure(editorThemeExtensions(themeName())),
  })
})

watch(() => props.readonly, () => {
  viewRef.value?.dispatch({
    effects: readOnlyCompartment.reconfigure(readOnlyExtension()),
  })
})

watch([() => configStore.editorFontSize, () => configStore.editorFontStack], () => {
  viewRef.value?.dispatch({
    effects: fontCompartment.reconfigure(fontExtension()),
  })
})

/**
 * 在当前光标（或选区）处插入文本。
 *
 * 与 Monaco 版本行为一致：可撤销（CM6 每次 dispatch 都是独立撤销单元），
 * 插入后若文本含占位词则选中它，方便直接改写。
 *
 * @returns 是否插入成功（编辑器未就绪时为 false）
 */
function insertText(text: string, placeholder = '变量'): boolean {
  const view = viewRef.value
  if (!text || !view) {
    return false
  }

  try {
    const selection = view.state.selection.main
    const start = selection.from
    const index = text.indexOf(placeholder)
    const anchor = index >= 0 ? start + index : start + text.length
    const head = index >= 0 ? anchor + placeholder.length : anchor

    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor, head },
      scrollIntoView: true,
    })
    view.focus()
    return true
  }
  catch (e) {
    // 插入失败时明确告知，避免「点了没反应」
    console.error('[CodeEditor] insertText failed', e)
    return false
  }
}

/** 供父组件调用：仅暴露插入能力，避免外部直接操作编辑器 */
defineExpose({ insertText })
</script>

<template>
  <div ref="host" class="code-editor" :style="{ height }" />
</template>

<style scoped>
/*
 * 容器只负责尺寸：编辑器背景透明、内部滚动由 CM6 自己处理
 * （背景与光标等配色在 utils/logLanguage.ts 的 EditorView.theme 里）。
 */
.code-editor {
  overflow: hidden;
}

.code-editor :deep(.cm-editor) {
  height: 100%;
}

.code-editor :deep(.cm-editor.cm-focused) {
  outline: none;
}

.code-editor :deep(.cm-scroller) {
  overflow: auto;
}

/* 补全弹层的滚动条跟随全局滚动条美化，避免出现系统默认样式 */
.code-editor :deep(.cm-tooltip-autocomplete > ul) {
  max-height: 260px;
}
</style>
