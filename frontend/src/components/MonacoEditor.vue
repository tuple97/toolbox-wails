<script setup lang="ts">
import { computed } from 'vue'
import { VueMonacoEditor } from '@guolao/vue-monaco-editor'
import type { editor } from 'monaco-editor'
import { useConfigStore } from '@/stores/configStore'
import { APP_THEME_DARK, APP_THEME_LIGHT } from '@/utils/logLanguage'

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
  return configStore.theme === 'dark' ? APP_THEME_DARK : APP_THEME_LIGHT
})

/** 编辑器配置；字号响应全局设置 */
const editorOptions = computed<editor.IStandaloneEditorConstructionOptions>(() => ({
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: configStore.editorFontSize,
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
    @update:value="handleUpdate"
  />
</template>
