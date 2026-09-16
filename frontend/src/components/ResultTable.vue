<script setup lang="ts">
import { computed } from 'vue'
import { useDictStore } from '@/stores/dictStore'
import { buildColumns, createMappingLookup, formatCell } from '@/utils/dictFormatter'
import { suggestionsForRow } from '@/utils/sql/explainTips'
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

/**
 * 列头悬停提示：列名 / 类型 / 备注的完整文本。
 *
 * 列头本身每行都会被截断（列宽固定、也不能让长注释把表头撑高），
 * 完整内容放 title 里，鼠标停一下就能看到全的。
 */
function headTitle(col: { label: string, type: string, comment: string }): string {
  return [col.label, col.type, col.comment].filter(Boolean).join('\n')
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
        <!--
          列头三行：列名 / 类型 / 备注。
          后两行浅色小字、按需出现（类型或备注为空则整行不渲染），
          每行各自截断，完整内容走 title（应用内小提示）。
        -->
        <template #header>
          <div class="result-table__head" :title="headTitle(col)">
            <span class="result-table__head-name">{{ col.label }}</span>
            <span v-if="col.type" class="result-table__head-meta">{{ col.type }}</span>
            <span v-if="col.comment" class="result-table__head-meta">{{ col.comment }}</span>
          </div>
        </template>
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

/*
 * 列头是三行结构，每行单独单行截断（宽度仍由列宽决定，不会自动加宽）。
 * Element Plus 默认的 .cell 有内边距与 nowrap，这里只放开换行，
 * 具体行数与截断交给下面的 .result-table__head*。
 */
.result-table :deep(.el-table__header .cell) {
  white-space: normal;
  line-height: 1.35;
}

.result-table__head {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.result-table__head-name,
.result-table__head-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 类型与备注：比列名小一号、弱化颜色。
 * 字号必须走主题变量，否则「设置 → 字体大小」对它们无效。
 */
.result-table__head-meta {
  color: var(--text-muted);
  font-size: var(--app-font-size-2xs);
  font-weight: 400;
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
 *
 * 外观也统一成应用自己的浮层观感（与编辑器里的列悬停卡片一致）：
 * Element Plus 默认的纯黑小方块在亮色主题下很突兀、圆角与内边距也偏紧。
 */
.result-table-tip.el-popper {
  max-width: 480px;
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--overlay-bg);
  box-shadow: var(--shadow-md);
  color: var(--text-color);
  font-size: var(--app-font-size-xs);
  white-space: pre-line;
  line-height: 1.7;
}

.result-table-tip.el-popper .el-popper__arrow::before {
  background: var(--overlay-bg);
  border-color: var(--border-color);
}
</style>
