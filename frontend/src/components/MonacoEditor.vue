<script setup lang="ts">
/**
 * 编辑器代理组件（历史名保留）。
 *
 * 实现已从 Monaco 迁移到 CodeMirror 6（见 CodeEditor.vue），
 * 这里刻意保留原有的 props / emits / defineExpose 签名，
 * 使 ExecutionLog、CommandExecutorView、SqlTemplateView 等调用方
 * 不需要改 import 与用法。
 *
 * 唯一需要注意的差异：mount 事件的载荷从 Monaco 编辑器实例变成了
 * CM6 的 EditorView（CommandExecutorView 已同步）。
 */
import { ref } from 'vue'
import CodeEditor from '@/components/CodeEditor.vue'
import type { EditorView } from '@codemirror/view'
import type { RunnableStatement } from '@/utils/sqlRunGutter'

withDefaults(defineProps<{
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
  /** 是否给识别出的每条 SQL 套边框（命令执行器用） */
  showStatementFrames?: boolean
  /** 是否在行号左侧显示「执行这条语句」按钮（命令执行器用） */
  showRunButtons?: boolean
  /** 数据库类型（mysql / postgres…），决定 SQL 方言：影响反引号与语法树节点 */
  dbType?: string
}>(), {
  language: 'sql',
  theme: '',
  readonly: false,
  height: '260px',
  showLineNumbers: true,
  disableSuggestions: false,
  showStatementFrames: false,
  showRunButtons: false,
  dbType: '',
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'change', value: string): void
  /** 编辑器实例就绪（CM6 的 EditorView） */
  (e: 'mount', view: EditorView): void
  /** 光标 / 选区变化（无载荷信号） */
  (e: 'selection'): void
  /** 点击语句左侧的运行按钮 */
  (e: 'run-statement', statement: RunnableStatement): void
}>()

const codeEditorRef = ref<InstanceType<typeof CodeEditor> | null>(null)

/** 透传插入能力（SqlTemplateView 的片段插入依赖它） */
function insertText(text: string, placeholder = '变量'): boolean {
  return codeEditorRef.value?.insertText(text, placeholder) ?? false
}

defineExpose({ insertText })
</script>

<template>
  <CodeEditor
    ref="codeEditorRef"
    :model-value="modelValue"
    :language="language"
    :db-type="dbType"
    :theme="theme"
    :readonly="readonly"
    :height="height"
    :show-line-numbers="showLineNumbers"
    :disable-suggestions="disableSuggestions"
    :show-statement-frames="showStatementFrames"
    :show-run-buttons="showRunButtons"
    @update:model-value="emit('update:modelValue', $event)"
    @change="emit('change', $event)"
    @mount="emit('mount', $event)"
    @selection="emit('selection')"
    @run-statement="emit('run-statement', $event)"
  />
</template>
