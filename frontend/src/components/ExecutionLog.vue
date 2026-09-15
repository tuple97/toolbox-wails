<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { EditorView } from '@codemirror/view'
import ContextMenu from '@/components/ContextMenu.vue'
import MonacoEditor from '@/components/MonacoEditor.vue'
import { copyText } from '@/utils/clipboard'
import { useLogStore } from '@/stores/logStore'
import { LOG_LANGUAGE_ID } from '@/utils/logLanguage'
import type { ContextMenuAction } from '@/types'

const props = withDefaults(defineProps<{
  /**
   * 日志区高度（px，展开时生效）。
   * 由宿主（如命令执行器）拖动分栏调整，默认 150。
   */
  height?: number
  /**
   * 嵌入模式：作为宿主页签的内容展示——
   * 不渲染自己的标题栏（页签就是标题），高度占满宿主容器，
   * 也不再受「展开 / 收起」状态控制。
   */
  embedded?: boolean
}>(), {
  height: 150,
  embedded: false,
})

const logStore = useLogStore()

/** 日志文本：把多行记录拼成完整文本交给编辑器展示 */
const logText = computed(() => logStore.entries.join('\n'))

/** 日志编辑器高度：嵌入模式占满容器，独立模式跟随可调高度 */
const panelHeight = computed(() => (props.embedded ? '100%' : `${props.height}px`))

/** 日志编辑器实例（只读展示，仅用于取选中内容 / 复制） */
const viewRef = shallowRef<EditorView | null>(null)

function handleEditorMount(view: EditorView) {
  viewRef.value = view
}

// ---------------------------------------------------------------- 右键菜单

const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)

/** 菜单项：复制（选中内容，没有选中则当前行）与复制全部 */
const menuItems = computed<ContextMenuAction[]>(() => {
  const empty = !logStore.entries.length
  return [
    { key: 'copy', label: '复制', shortcut: 'Ctrl+C', disabled: empty, divided: true },
    { key: 'copy-all', label: '复制全部', disabled: empty },
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
  if (!props.embedded && !logStore.expanded) {
    return
  }
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
    :class="{
      'log-panel--collapsed': !logStore.expanded && !props.embedded,
      'log-panel--embedded': props.embedded,
    }"
    @contextmenu.prevent="openMenu"
    @keydown="handleKeydown"
  >
    <!-- 嵌入模式下不渲染标题栏：页签本身就是标题 -->
    <header v-if="!props.embedded" class="log-panel__head">
      <button
        class="log-panel__toggle"
        type="button"
        @click="logStore.expanded = !logStore.expanded"
      >
        <el-icon>
          <ArrowUp v-if="logStore.expanded" />
          <ArrowDown v-else />
        </el-icon>
        <span>执行记录</span>
        <el-badge
          v-if="logStore.entries.length"
          :value="logStore.entries.length"
          type="info"
          class="log-panel__badge"
        />
      </button>

      <el-button link size="small" @click="logStore.clear()">
        清空
      </el-button>
    </header>

    <div v-show="props.embedded || logStore.expanded" class="log-panel__body" :style="{ height: panelHeight }">
      <MonacoEditor
        :model-value="logText"
        :language="LOG_LANGUAGE_ID"
        readonly
        disable-suggestions
        :height="panelHeight"
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
.log-panel {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  border-top: 1px solid var(--border-color);
  background: var(--panel-bg);
}

.log-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: calc(30px * var(--app-control-scale));
  padding: 0 12px;
}

.log-panel__toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--app-font-size-sm);
  cursor: pointer;
}

.log-panel__toggle:hover {
  color: var(--text-color);
}

.log-panel__badge {
  margin-left: 4px;
}

.log-panel__body {
  height: 150px;
  overflow: hidden;
}

.log-panel--collapsed .log-panel__body {
  height: 0;
  display: none;
}

/* 嵌入模式：占满宿主容器（页签内容区），去掉独立面板的分界线与底色 */
.log-panel--embedded {
  flex: 1;
  min-height: 0;
  border-top: none;
  background: transparent;
}

.log-panel--embedded .log-panel__body {
  height: 100%;
}

/*
 * 日志编辑器背景透明由 utils/logLanguage.ts 的主题扩展负责
 * （EditorView.theme 里统一把 background 设为 transparent），
 * 这里不再重复写，避免新增编辑器时漏掉。
 */
</style>
