<script setup lang="ts">
import { computed } from 'vue'
import type { ScriptRunSummary, StatementRunRecord } from '@/types'

/**
 * 「执行全部」的摘要页签。
 *
 * 上半部分为整体信息（语句总数 / 成功 / 失败 / 开始时间 / 结束时间 / 总耗时），
 * 下半部分是逐条语句的执行明细表。
 */
const props = defineProps<{
  summary: ScriptRunSummary
}>()

/** 时间戳 → HH:mm:ss.SSS */
function formatTime(value: number): string {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  const pad = (num: number, length = 2) => String(num).padStart(length, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

/** 耗时格式化：小于 1 秒显示 ms，否则显示秒 */
function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`
}

/** 顶部整体信息 */
const stats = computed(() => [
  { label: '语句总数', value: `${props.summary.records.length} 条` },
  { label: '成功', value: `${props.summary.successCount} 条` },
  { label: '失败', value: `${props.summary.failedCount} 条` },
  { label: '开始时间', value: formatTime(props.summary.startedAt) },
  {
    label: '结束时间',
    value: props.summary.finishedAt ? formatTime(props.summary.finishedAt) : '执行中…',
  },
  { label: '总耗时', value: props.summary.totalMs ? formatDuration(props.summary.totalMs) : '—' },
])

/** 状态文案 */
function statusText(record: StatementRunRecord): string {
  switch (record.status) {
    case 'success':
      return '成功'
    case 'failed':
      return '失败'
    case 'cancelled':
      return '已取消'
    default:
      return '运行中'
  }
}

/** 状态标签样式 */
function statusType(record: StatementRunRecord): 'success' | 'danger' | 'info' | 'primary' {
  switch (record.status) {
    case 'success':
      return 'success'
    case 'failed':
      return 'danger'
    case 'cancelled':
      return 'info'
    default:
      return 'primary'
  }
}

/** 结果列文案：查询给返回行数、执行给影响行数，失败/取消给原因 */
function resultText(record: StatementRunRecord): string {
  if (record.status === 'failed' || record.status === 'cancelled') {
    return record.error ?? statusText(record)
  }
  if (record.status !== 'success') {
    return '—'
  }
  if (record.kind === 'query' && record.rowCount !== undefined) {
    return `返回 ${record.rowCount} 行`
  }
  if (record.kind === 'exec' && record.affectedRows !== undefined) {
    return `影响 ${record.affectedRows} 行`
  }
  return '—'
}
</script>

<template>
  <div class="script-summary">
    <div class="script-summary__stats">
      <div v-for="item in stats" :key="item.label" class="script-summary__stat">
        <span class="script-summary__stat-label">{{ item.label }}</span>
        <span class="script-summary__stat-value">{{ item.value }}</span>
      </div>
    </div>

    <el-table
      :data="summary.records"
      size="small"
      border
      height="100%"
      class="script-summary__table"
      empty-text="没有可执行的语句"
    >
      <el-table-column type="index" label="#" width="52" align="center" />
      <el-table-column prop="sql" label="语句" min-width="220" show-overflow-tooltip />
      <el-table-column label="状态" width="96" align="center">
        <template #default="{ row }">
          <el-tag :type="statusType(row)" size="small" effect="light">
            {{ statusText(row) }}
          </el-tag>
        </template>
      </el-table-column>
      <!-- 截断时悬停出完整内容，与「语句」列同一行为（show-overflow-tooltip） -->
      <el-table-column label="结果" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">
          <span
            class="script-summary__result"
            :class="{ 'script-summary__result--error': row.status === 'failed' || row.status === 'cancelled' }"
          >{{ resultText(row) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="开始时间" width="118" align="center">
        <template #default="{ row }">{{ formatTime(row.startedAt) }}</template>
      </el-table-column>
      <el-table-column label="结束时间" width="118" align="center">
        <template #default="{ row }">{{ row.finishedAt ? formatTime(row.finishedAt) : '执行中…' }}</template>
      </el-table-column>
      <el-table-column label="耗时" width="100" align="right">
        <template #default="{ row }">
          {{ row.finishedAt ? formatDuration(row.elapsedMs) : '—' }}
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.script-summary {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 10px;
}

.script-summary__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  flex: 0 0 auto;
}

.script-summary__stat {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--surface-color);
}

.script-summary__stat-label {
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
}

.script-summary__stat-value {
  color: var(--text-color);
  font-size: var(--app-font-size-sm);
  font-weight: 600;
}

.script-summary__table {
  flex: 1;
  min-height: 0;
  background: transparent;
}

/* 结果列：默认弱化色，失败/取消用错误色，长文本截断（不弹悬停提示） */
.script-summary__result {
  color: var(--text-muted);
  font-size: var(--app-font-size-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.script-summary__result--error {
  color: var(--danger-color, var(--el-color-danger));
}

.script-summary__table :deep(.el-table__cell) {
  font-size: var(--app-font-size-sm);
  user-select: text;
  -webkit-user-select: text;
}
</style>
