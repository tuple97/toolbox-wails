<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import MonacoEditor from '@/components/MonacoEditor.vue'
import { useLogStore } from '@/stores/logStore'

const logStore = useLogStore()

/** 日志文本：把多行记录拼成完整文本交给 Monaco 展示 */
const logText = computed(() => logStore.entries.join('\n'))

/** 高度固定约 150px（展开时） */
const PANEL_HEIGHT = '150px'

/**
 * 日志变化后自动滚动到底部。
 * Monaco 的滚动容器 class 固定，直接操作 DOM 比等待组件实例更可靠。
 */
watch(() => logStore.entries.length, async () => {
  if (!logStore.expanded) {
    return
  }
  await nextTick()
  // 展开状态下若 DOM 尚未渲染，下一帧再试一次
  requestAnimationFrame(() => {
    const containers = document.querySelectorAll('.log-panel__body .monaco-scrollable-element')
    const el = containers[containers.length - 1]
    if (el instanceof HTMLElement) {
      el.scrollTop = el.scrollHeight
    }
  })
})
</script>

<template>
  <section class="log-panel" :class="{ 'log-panel--collapsed': !logStore.expanded }">
    <header class="log-panel__head">
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

    <div v-show="logStore.expanded" class="log-panel__body">
      <MonacoEditor
        :model-value="logText"
        language="plaintext"
        readonly
        :show-line-numbers="false"
        disable-suggestions
        :height="PANEL_HEIGHT"
      />
    </div>
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
  height: 30px;
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
  font-size: 12px;
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
</style>
