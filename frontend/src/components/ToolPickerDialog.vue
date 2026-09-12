<script setup lang="ts">
import { computed } from 'vue'
import { TOOLS } from '@/utils/tools'
import type { ToolType } from '@/types'

/**
 * 工具选择弹窗。
 *
 * 入口：标签栏左侧的 + 按钮。
 * 多例工具：选择后新建一个实例标签并自动命名（如「SQL 查询 2」）；
 * 单例工具：选择后跳转到已有标签（不存在则新建）。
 */

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'select', type: ToolType): void
}>()

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

/** 多例工具排前面，单例在后，便于快速找到可新建的功能 */
const tools = computed(() => [
  ...TOOLS.filter(tool => tool.multi),
  ...TOOLS.filter(tool => !tool.multi),
])

function handlePick(type: ToolType) {
  emit('select', type)
  dialogVisible.value = false
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    title="选择工具"
    width="560px"
    class="tool-picker"
  >
    <p class="tool-picker__hint">
      多例工具每次都会新建一个标签；单例工具会跳转到已打开的标签。
    </p>

    <div class="tool-picker__grid">
      <button
        v-for="tool in tools"
        :key="tool.type"
        class="tool-picker__card"
        type="button"
        @click="handlePick(tool.type)"
      >
        <el-icon class="tool-picker__icon">
          <component :is="tool.icon" />
        </el-icon>
        <span class="tool-picker__name">
          {{ tool.label }}
          <span
            class="tool-picker__badge"
            :class="{ 'is-multi': tool.multi }"
          >
            {{ tool.multi ? '多例' : '单例' }}
          </span>
        </span>
        <span class="tool-picker__desc">{{ tool.description }}</span>
      </button>
    </div>

    <template #footer>
      <el-button @click="dialogVisible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.tool-picker__hint {
  margin: 0 0 14px;
  color: var(--text-muted);
  font-size: var(--app-font-size-sm);
  line-height: 1.6;
}

.tool-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 12px;
}

.tool-picker__card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--surface-color);
  color: var(--text-color);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease, background-color 0.15s ease;
}

.tool-picker__card:hover {
  border-color: var(--brand-color);
  background: var(--active-bg);
  transform: translateY(-2px);
}

.tool-picker__icon {
  /* 图标属于控件，跟随「控件大小」缩放 */
  font-size: calc(20px * var(--app-control-scale));
  color: var(--brand-color);
}

.tool-picker__name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--app-font-size-lg);
  font-weight: 600;
}

/* 多例/单例标记 */
.tool-picker__badge {
  padding: 0 6px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-muted);
  font-size: var(--app-font-size-2xs);
  font-weight: 400;
  line-height: 1.6;
}

.tool-picker__badge.is-multi {
  border-color: var(--brand-color);
  color: var(--brand-color);
}

.tool-picker__desc {
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
  line-height: 1.5;
}
</style>
