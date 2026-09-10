<script setup lang="ts">
import { computed } from 'vue'
import { VueMonacoEditor } from '@guolao/vue-monaco-editor'
import type { editor } from 'monaco-editor'
import { useConfigStore } from '@/stores/configStore'

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

/** 编辑器主题跟随全局配置 */
const editorTheme = computed(() => {
  if (props.theme) {
    return props.theme
  }
  return configStore.theme === 'dark' ? 'vs-dark' : 'vs'
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
  // 只读 / 日志场景关闭智能提示，避免误交互
  quickSuggestions: props.disableSuggestions ? false : undefined,
  suggestOnTriggerCharacters: !props.disableSuggestions,
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
