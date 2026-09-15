<script setup lang="ts">
import { computed } from 'vue'
import { useDictStore } from '@/stores/dictStore'
import { buildColumns, createMappingLookup, formatCell } from '@/utils/dictFormatter'
import { suggestionsForRow } from '@/utils/explainTips'
import type { FieldMapping, QueryResult } from '@/types'

const props = withDefaults(defineProps<{
  /** 查询结果 */
  result: QueryResult
  /** 字段映射配置 */
  mappings: FieldMapping[]
  /** 是否为 EXPLAIN 分析结果：单元格悬停时给出优化建议 */
  analysis?: boolean
}>(), {
  mappings: () => [],
  analysis: false,
})

const emit = defineEmits<{
  /**
   * 行右键：带上被点的行与鼠标位置。
   * 菜单内容与后续动作由调用方决定（结果集「复制为 SQL」是其中一个用途）。
   */
  (e: 'row-contextmenu', payload: { row: Record<string, unknown>, x: number, y: number }): void
}>()

/** 行右键：把鼠标位置一并上报，父级据此弹自定义菜单 */
function handleRowContextMenu(row: Record<string, unknown>, _column: unknown, event: Event) {
  const mouse = event as MouseEvent
  emit('row-contextmenu', { row, x: mouse.clientX, y: mouse.clientY })
}

const dictStore = useDictStore()

/** 按映射配置生成表格列 */
const columns = computed(() => buildColumns(props.result.columns, props.mappings))

/** 列名 → 映射配置，避免每格重复遍历 */
const mappingLookup = computed(() => createMappingLookup(props.mappings))

/**
 * 单元格渲染。
 * 命中词典时按模板展示释义，并把描述作为悬浮提示；
 * EXPLAIN 分析结果再把该行的优化建议合并进悬浮提示（多行，见 explainTips）。
 */
function renderCell(row: Record<string, unknown>, column: string) {
  const cell = formatCell(row[column], mappingLookup.value(column), dictStore.lookup)
  if (!props.analysis) {
    return cell
  }
  const advice = suggestionsForRow(row)
  if (!advice.length) {
    return cell
  }
  const tips = advice.map(item => `【${item.source}】${item.text}`)
  return { ...cell, tooltip: [cell.tooltip, ...tips].filter(Boolean).join('\n') }
}

/**
 * 行号列：跨页连续——第 page 页的第一行接着上一页编号
 * （offset = (page - 1) * pageSize；未分页时 pageSize 为 0，offset 恒为 0）。
 */
function rowIndex(index: number): number {
  const page = props.result.page ?? 1
  const size = props.result.pageSize ?? 0
  return (page - 1) * size + index + 1
}
</script>

<template>
  <!-- selectable：允许选中表头与单元格文本，便于 Ctrl+C 复制 -->
  <div class="result-table selectable">
    <el-table
      :data="result.rows"
      size="small"
      height="100%"
      border
      stripe
      empty-text="查询成功，但未返回数据"
      @row-contextmenu="handleRowContextMenu"
    >
      <!-- 序号列：跨页连续的行号 -->
      <el-table-column label="#" width="64" align="center">
        <template #default="{ $index }">{{ rowIndex($index) }}</template>
      </el-table-column>
      <el-table-column
        v-for="col in columns"
        :key="col.column"
        :label="col.label"
        :width="col.width"
        :align="col.align"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <!-- 每格只计算一次渲染结果，避免重复调用 -->
          <el-tooltip
            v-if="renderCell(row, col.column).tooltip"
            :content="renderCell(row, col.column).tooltip"
            placement="top"
            :show-after="300"
            popper-class="result-table-tip"
          >
            <span
              class="result-table__cell"
              :class="{ 'result-table__cell--matched': renderCell(row, col.column).matched }"
            >
              {{ renderCell(row, col.column).text }}
            </span>
          </el-tooltip>
          <span v-else>{{ renderCell(row, col.column).text }}</span>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.result-table {
  flex: 1;
  min-height: 0;
  padding: 0 16px 12px;
}

.result-table__cell {
  cursor: help;
}

.result-table__cell--matched {
  color: var(--brand-color);
}

.result-table :deep(.el-table) {
  background: transparent;
}

/*
 * 允许选中与复制：表头与单元格都要放开 user-select，
 * body 上的全局禁选（桌面应用观感）不适用于结果集。
 */
.result-table :deep(.el-table__cell),
.result-table :deep(.el-table__header-wrapper),
.result-table :deep(.el-table__body-wrapper) {
  user-select: text;
  -webkit-user-select: text;
}

.result-table :deep(.el-table__cell) {
  font-size: var(--app-font-size-sm);
}
</style>

<style>
/*
 * 分析建议气泡：teleport 到 body，scoped 样式够不到，所以放开为全局类。
 * 内容是多条建议（换行分隔），必须保留换行。
 */
.result-table-tip {
  max-width: 480px;
  white-space: pre-line;
  line-height: 1.7;
}
</style>
