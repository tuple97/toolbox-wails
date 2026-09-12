<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { VueMonacoEditor } from '@guolao/vue-monaco-editor'
import type { editor } from 'monaco-editor'
import { useConfigStore } from '@/stores/configStore'
import {
  APP_THEME_DARK,
  APP_THEME_IDEA,
  APP_THEME_LIGHT,
  APP_THEME_MIDNIGHT,
} from '@/utils/logLanguage'

const props = withDefaults(defineProps<{
  /** 编辑内容（v-model） */
  modelValue: string
  /** 语言，SQL 时启用关键字高亮 */
  language?: string
  /** 主题；留空时跟随全局配置 */
  theme?: string
  /** 是否只读 */
  readonly?: boolean
  /** 编辑器高度 */
  height?: string
  /** 是否显示行号 */
  showLineNumbers?: boolean
  /** 是否关闭智能提示（日志展示场景） */
  disableSuggestions?: boolean
}>(), {
  language: 'sql',
  theme: '',
  readonly: false,
  height: '260px',
  showLineNumbers: true,
  disableSuggestions: false,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'change', value: string): void
}>()

const configStore = useConfigStore()

/**
 * 编辑器主题跟随全局配置。
 *
 * 所有编辑器统一使用应用主题（vs-dark / vs 的扩展版），
 * 不直接使用 vs-dark / vs——Monaco 主题是全局的，
 * 否则任一编辑器切到内置主题都会覆盖掉日志的自定义 token 颜色。
 */
const editorTheme = computed(() => {
  if (props.theme) {
    return props.theme
  }
  // 每种应用主题对应一套编辑器配色（背景与调色板一致）
  switch (configStore.theme) {
    case 'light':
      return APP_THEME_LIGHT
    case 'midnight':
      return APP_THEME_MIDNIGHT
    case 'idea':
      return APP_THEME_IDEA
    default:
      return APP_THEME_DARK
  }
})

/** 编辑器配置；字号与字体响应全局设置（编辑器字体独立于界面字体） */
const editorOptions = computed<editor.IStandaloneEditorConstructionOptions>(() => ({
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: configStore.editorFontSize,
  // 编辑器字体：设置里「编辑器字体」单独指定，默认与界面一致（Nunito）
  fontFamily: configStore.editorFontStack,
  lineNumbers: props.showLineNumbers ? 'on' : 'off',
  scrollBeyondLastLine: false,
  tabSize: 2,
  wordWrap: 'on',
  readOnly: props.readonly,
  renderLineHighlight: props.readonly ? 'none' : 'line',
  // 关闭 Monaco 自带右键菜单，统一走应用自定义菜单策略
  contextmenu: false,
  // 只读 / 日志场景关闭智能提示，避免误交互
  quickSuggestions: props.disableSuggestions ? false : undefined,
  suggestOnTriggerCharacters: !props.disableSuggestions,
  // 概览标尺（滚动条旁的「全文预览」标记）在本应用所有编辑器里都不需要，统一关闭
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  // 滚动时顶部不再悬浮当前行的「粘性」预览
  stickyScroll: { enabled: false },
  scrollbar: {
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
  },
}))

/**
 * 编辑器实例（由 @guolao/vue-monaco-editor 的 mount 事件给出）。
 *
 * 必须用 shallowRef：Monaco 实例体积巨大且内部互相引用，
 * 放进普通 ref 会被深层代理成响应式对象，调用时开销极高甚至卡死界面，
 * 且 `ed === editorInstance.value` 会因代理而不再成立。
 */
const editorInstance = shallowRef<editor.IStandaloneCodeEditor | null>(null)

/** 编辑器创建完成后保存实例，供插入片段等命令式操作使用 */
function handleEditorMount(ed: editor.IStandaloneCodeEditor) {
  editorInstance.value = ed
}

/**
 * 在当前光标（或选区）处插入文本。
 *
 * 使用 executeEdits 而非 setValue：可撤销，且不会重置光标。
 * 插入后若文本中包含占位词，会选中该词方便直接改写。
 *
 * @param text 待插入文本
 * @param placeholder 需要被选中的占位词，默认「变量」
 * @returns 是否插入成功（编辑器未就绪时为 false）
 */
function insertText(text: string, placeholder = '变量'): boolean {
  const ed = editorInstance.value
  const model = ed?.getModel()
  const selection = ed?.getSelection()
  if (!text || !ed || !model || !selection) {
    return false
  }

  try {
    // 记录插入起点在文档中的偏移，用于定位占位词
    const startOffset = model.getOffsetAt(selection.getStartPosition())

    ed.executeEdits('insert-snippet', [{ range: selection, text, forceMoveMarkers: true }])
    ed.pushUndoStop()

    const index = text.indexOf(placeholder)
    if (index >= 0) {
      const start = model.getPositionAt(startOffset + index)
      const end = model.getPositionAt(startOffset + index + placeholder.length)
      ed.setSelection({
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      })
    }

    ed.focus()
    return true
  }
  catch (e) {
    // 插入失败时明确告知，避免「点了没反应」
    console.error('[MonacoEditor] insertText failed', e)
    return false
  }
}

// 供父组件调用：仅暴露插入能力，避免外部直接操作编辑器
defineExpose({ insertText })

function handleUpdate(value: string) {
  // 只读模式不向上抛更新，避免意外写入
  if (props.readonly) {
    return
  }
  // 程序化 setValue（父组件写入）触发的 change 不回抛：
  // 值与 props 一致说明是父组件刚写入的，回抛只会造成冗余的响应链
  if (value === props.modelValue) {
    return
  }
  emit('update:modelValue', value)
  emit('change', value)
}
</script>

<template>
  <VueMonacoEditor
    :value="modelValue"
    :language="language"
    :theme="editorTheme"
    :options="editorOptions"
    :style="{ height }"
    @mount="handleEditorMount"
    @update:value="handleUpdate"
  />
</template>
