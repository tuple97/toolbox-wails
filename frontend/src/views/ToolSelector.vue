<script setup lang="ts">
import type { ToolType } from '@/types'

const emit = defineEmits<{
  (e: 'select', toolType: ToolType): void
}>()

/** 工具清单。新增工具只需在此补充一项。 */
const tools: Array<{
  type: ToolType
  name: string
  description: string
  icon: string
}> = [
  {
    type: 'db-query',
    name: '数据库查询',
    description: '编写 SQL 模板、配置变量、执行查询并翻译字段',
    icon: 'DataLine',
  },
]
</script>

<template>
  <div class="selector">
    <header class="selector__header">
      <h2 class="selector__title">选择一个工具</h2>
      <p class="selector__desc">选定后该标签将固定承载该工具，如需更换请关闭标签后重建</p>
    </header>

    <div class="selector__grid">
      <button
        v-for="tool in tools"
        :key="tool.type"
        class="selector__card"
        type="button"
        @click="emit('select', tool.type)"
      >
        <el-icon class="selector__icon"><component :is="tool.icon" /></el-icon>
        <span class="selector__name">{{ tool.name }}</span>
        <span class="selector__desc-text">{{ tool.description }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.selector {
  height: 100%;
  overflow: auto;
  padding: 40px;
}

.selector__header {
  margin-bottom: 28px;
}

.selector__title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 600;
}

.selector__desc {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}

.selector__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  max-width: 900px;
}

.selector__card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 20px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--surface-color);
  color: var(--text-color);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.selector__card:hover {
  border-color: var(--brand-color);
  transform: translateY(-2px);
}

.selector__icon {
  font-size: 24px;
  color: var(--brand-color);
}

.selector__name {
  font-size: 15px;
  font-weight: 600;
}

.selector__desc-text {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}
</style>
