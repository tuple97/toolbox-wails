<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { EditorView } from '@codemirror/view'
import ContextMenu from '@/components/ContextMenu.vue'
import CodeEditor from '@/components/CodeEditor.vue'
import { copyText } from '@/utils/clipboard'
import { useLogStore } from '@/stores/logStore'
import { LOG_LANGUAGE_ID } from '@/utils/logLanguage'
import type { ContextMenuAction } from '@/types'

const logStore = useLogStore()

/** 日志文本：把多行记录拼成完整文本交给编辑器展示 */
const logText = computed(() => logStore.entries.join('\n'))

/** 日志编辑器实例（只读展示，仅用于取选中内容 / 复制） */
const viewRef = shallowRef<EditorView | null>(null)

function handleEditorMount(view: EditorView) {
  viewRef.value = view
}

// ---------------------------------------------------------------- 右键菜单

const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)

/**
 * 菜单项：复制（选中内容，没有选中则当前行）、复制全部、清空。
 * 标题栏已由宿主的页签取代，所以「清空」入口放在这里。
 */
const menuItems = computed<ContextMenuAction[]>(() => {
  const empty = !logStore.entries.length
  return [
    { key: 'copy', label: '复制', shortcut: 'Ctrl+C', disabled: empty },
    { key: 'copy-all', label: '复制全部', disabled: empty },
    { key: 'clear', label: '清空日志', disabled: empty, divided: true },
  ]
})

/** 右键：定位菜单；若点在编辑器里且当前没有选中，把光标挪到点击处，复制时就是这一行 */
function openMenu(event: MouseEvent) {
  menuX.value = event.clientX
  menuY.value = event.clientY
  menuVisible.value = true

  const view = viewRef.value
  if (!view || !view.dom.contains(event.target as Node)) {
    return
  }
  if (!view.state.selection.main.empty) {
    return
  }
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
  if (pos != null) {
    view.dispatch({ selection: { anchor: pos } })
  }
}

/** 要复制的内容：有选中复制选中，否则复制光标所在行 */
function selectedOrCurrentLine(): string {
  const view = viewRef.value
  if (!view) {
    // 编辑器还没就绪：退化为整段日志，避免点了没反应
    return logText.value
  }
  const range = view.state.selection.main
  if (!range.empty) {
    return view.state.sliceDoc(range.from, range.to)
  }
  const line = view.state.doc.lineAt(range.from)
  return view.state.sliceDoc(line.from, line.to)
}

/** 写剪贴板 + 统一提示 */
async function copyWithToast(text: string, message: string) {
  if (!text) {
    ElMessage.warning('没有可复制的内容')
    return
  }
  try {
    await copyText(text)
    ElMessage.success(message)
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
}

async function handleMenuSelect(item: ContextMenuAction) {
  if (item.key === 'copy') {
    await copyWithToast(selectedOrCurrentLine(), '已复制')
    return
  }
  if (item.key === 'copy-all') {
    await copyWithToast(logText.value, `已复制全部 ${logStore.entries.length} 行`)
    return
  }
  if (item.key === 'clear') {
    logStore.clear()
    ElMessage.success('执行记录已清空')
  }
}

/**
 * 面板内的快捷键：
 *  - Ctrl / Cmd + A：全选执行记录（显式接管，顺便阻止浏览器把整页纳入选择）；
 *  - Ctrl / Cmd + C：复制选中内容（编辑器本身也能处理，但全局禁用了文本选中，
 *    自己写一次剪贴板行为最稳，且与右键菜单完全一致；没有选中时不拦截，
 *    交给默认行为，避免「按了没反应还吞掉事件」）。
 * 带 Shift / Alt 的组合键一律放行，避免抢 Ctrl+Shift+C 这类调试快捷键。
 */
function handleKeydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) {
    return
  }
  const key = event.key.toLowerCase()
  if (key !== 'a' && key !== 'c') {
    return
  }

  const view = viewRef.value
  if (!view) {
    return
  }

  if (key === 'a') {
    event.preventDefault()
    view.focus()
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
    return
  }

  if (view.state.selection.main.empty) {
    return
  }
  event.preventDefault()
  void copyWithToast(selectedOrCurrentLine(), '已复制')
}

// ---------------------------------------------------------------- 滚动到底部

/**
 * 滚动到底部。
 * CM6 的滚动容器是 view.scrollDOM，直接操作比等组件实例更可靠；
 * 容器隐藏（display:none）时 scrollHeight 为 0，天然成为无操作。
 */
function scrollToBottom() {
  requestAnimationFrame(() => {
    const el = viewRef.value?.scrollDOM
    if (el instanceof HTMLElement) {
      el.scrollTop = el.scrollHeight
    }
  })
}

/** 日志变化后自动滚动到底部；宿主切到日志页签时也会调用 */
watch(() => logStore.entries.length, async () => {
  await nextTick()
  scrollToBottom()
})

defineExpose({
  scrollToBottom,
})
</script>

<template>
  <section
    class="log-panel"
    @contextmenu.prevent="openMenu"
    @keydown="handleKeydown"
  >
    <div class="log-panel__body">
      <CodeEditor
        :model-value="logText"
        :language="LOG_LANGUAGE_ID"
        completion-mode="none"
        readonly
        disable-suggestions
        height="100%"
        @mount="handleEditorMount"
      />
    </div>

    <!-- 右键菜单：复制 / 复制全部 -->
    <ContextMenu
      v-model:visible="menuVisible"
      :x="menuX"
      :y="menuY"
      :items="menuItems"
      @select="handleMenuSelect"
    />
  </section>
</template>

<style scoped>
/*
 * 日志视图：作为宿主页签的内容展示，占满容器。
 * 标题由宿主的页签提供，这里不再自带标题栏（清空请用右键菜单 / 宿主提供的入口）。
 */
.log-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.log-panel__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/*
 * 日志编辑器背景透明由 utils/logLanguage.ts 的主题扩展负责
 * （EditorView.theme 里统一把 background 设为 transparent），
 * 这里不再重复写，避免新增编辑器时漏掉。
 */
</style>
