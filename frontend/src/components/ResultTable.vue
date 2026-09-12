<script setup lang="ts">
import { computed } from 'vue'
import { useDictStore } from '@/stores/dictStore'
import { buildColumns, createMappingLookup, formatCell } from '@/utils/dictFormatter'
import type { FieldMapping, QueryResult } from '@/types'

const props = defineProps<{
  /** 查询结果 */
  result: QueryResult
  /** 字段映射配置 */
  mappings: FieldMapping[]
}>()

const dictStore = useDictStore()

/** 按映射配置生成表格列 */
const columns = computed(() => buildColumns(props.result.columns, props.mappings))

/** 列名 → 映射配置，避免每格重复遍历 */
const mappingLookup = computed(() => createMappingLookup(props.mappings))

/**
 * 单元格渲染。
 * 命中词典时按模板展示释义，并把描述作为悬浮提示。
 */
function renderCell(row: Record<string, unknown>, column: string) {
  return formatCell(row[column], mappingLookup.value(column), dictStore.lookup)
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
    >
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
