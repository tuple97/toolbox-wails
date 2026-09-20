<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Button from '@/components/ui/Button.vue'
import DataTable from '@/components/ui/DataTable.vue'
import Icon from '@/components/ui/Icon.vue'
import { copyText } from '@/utils/clipboard'
import { toCsv } from '@/utils/csv'
import { notify } from '@/utils/notify'
import { primaryKeysOfResult } from '@/utils/sql/rowSql'
import { typeColorTokenOf } from '@/utils/sql/typeBadge'
import { useDictStore } from '@/stores/dictStore'
import { buildColumns, createMappingLookup, formatCell } from '@/utils/dictFormatter'
import { suggestionsForRow } from '@/utils/sql/explainTips'
import type { TableColumn } from '@/utils/tableLayout'
import type { ResultSourceContext } from '@/utils/sql/rowSql'
import type { TypeColorToken } from '@/utils/sql/typeBadge'
import type { FieldMapping, QueryResult } from '@/types'

const props = withDefaults(defineProps<{
  /** 查询结果 */
  result: QueryResult
  /** 字段映射配置 */
  mappings: FieldMapping[]
  /** 是否为 EXPLAIN 分析结果：单元格悬停时给出优化建议 */
  analysis?: boolean
  /**
   * 结果来源（连接 / 库 / 产生它的 SQL）：用来查主键，给主键列加标识。
   * 不给也不影响别的功能 —— 只是表头没有主键标识。
   */
  source?: ResultSourceContext | null
}>(), {
  mappings: () => [],
  analysis: false,
  source: null,
})

const emit = defineEmits<{
  /**
   * 行右键：带上**本次要作用的行**与鼠标位置。
   *
   * `rows` 是「实际要操作的行」：多选且点命中了选区时是全部选中行，
   * 否则只有被点的那一行 —— 调用方不需要自己判断选区状态。
   */
  (e: 'row-contextmenu', payload: {
    row: Record<string, unknown>
    rows: Record<string, unknown>[]
    x: number
    y: number
  }): void
}>()

/**
 * 已选行下标（多选：Ctrl 加减选、Shift 区间选）。
 *
 * 状态放在这里而不是 `DataTable` 里：右键菜单、批量复制的提示都长在结果区，
 * 调用方（执行器 / 查询页）只关心「要做哪几行」，由本组件把选区翻译成行数据传出去。
 */
const selectedRows = ref<number[]>([])

/** 选区提示条上的计数 */
const selectedCount = computed(() => selectedRows.value.length)

/** 行右键：把鼠标位置与「要作用的行」一并上报 */
function handleRowContextMenu(payload: {
  row: Record<string, unknown>
  rows: Record<string, unknown>[]
  x: number
  y: number
}) {
  emit('row-contextmenu', { row: payload.row, rows: payload.rows, x: payload.x, y: payload.y })
}

function clearSelection() {
  selectedRows.value = []
}

/**
 * Ctrl+C：把选中行复制成 CSV（带列名）。
 *
 * 用的是**原始值**而不是单元格里显示的文本：表格可能做过词典翻译
 * （`1` → `启用`），而复制出去的数据通常要拿去比对或再导入 ——
 * 原始值才是有用的那个。要显示值的话，双击单元格选中文本再 Ctrl+C 即可。
 *
 * 文本被选中时不会走到这里：`DataTable` 会把那次 Ctrl+C 让给浏览器。
 */
async function handleCopyRows(payload: { rows: Record<string, unknown>[] }) {
  const columns = tableColumns.value
  const csv = toCsv(
    columns.map(col => col.label),
    payload.rows.map(row => columns.map(col => row[col.key])),
  )
  try {
    await copyText(csv)
    notify.success(`已复制 ${payload.rows.length} 行（CSV，含列名）`)
  }
  catch (e) {
    notify.error(e instanceof Error ? e.message : String(e))
  }
}

const dictStore = useDictStore()

/** 按映射配置生成表格列 */
const columns = computed(() => buildColumns(props.result.columns, props.mappings))

/**
 * 未配置宽度的结果列的最小宽度（px）。
 *
 * 结果集常有三四十列，下限给小了（比如 120）长值会被截成一条缝 ——
 * 用户看到的现象就是「列全挤在一起、字看不见」。
 * 给 150 起步，列多到装不下时由 DataTable 出横向滚动条，而不是压缩每一列。
 */
const RESULT_COLUMN_MIN_WIDTH = 150

/**
 * 表格列配置。
 *
 * 结果集的列是运行时来的，所以这里是「把 dictFormatter 的列描述翻译成 DataTable 的列」：
 * 已配置的固定宽度与对齐照搬，其余列给一个可读的下限宽度，超出截断统一打开
 * （结果集里长文本很常见）。
 */
const tableColumns = computed<TableColumn[]>(() => columns.value.map(col => ({
  key: col.column,
  label: col.label,
  width: col.width,
  minWidth: RESULT_COLUMN_MIN_WIDTH,
  align: col.align,
  ellipsis: true,
})))

/** 列键 → 列描述：表头要展示类型与备注，单元格要按列取值 */
const columnInfo = computed(() => new Map(columns.value.map(col => [col.column, col])))

/** 列名 → 映射配置，避免每格重复遍历 */
const mappingLookup = computed(() => createMappingLookup(props.mappings))

/**
 * 单元格渲染结果。
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
 * 列的元信息（表头两行与悬停卡片各取所需，取不到就给空串）。
 *
 * 悬停走富卡片：`data-col-*` 属性由全局 tooltip 读走拼卡片
 * （列名大、类型 / 来源表 / 描述小、图标带色），比纯文本 title 有层次。
 */
function typeOf(column: string): string {
  return columnInfo.value.get(column)?.type ?? ''
}

function commentOf(column: string): string {
  return columnInfo.value.get(column)?.comment ?? ''
}

function tableOf(column: string): string {
  return columnInfo.value.get(column)?.table ?? ''
}

/**
 * 类型药丸的配色：语义由 `typeBadge` 决定（按类型大类），
 * 具体类名在这里 —— 换主题只动这一处。
 */
const TYPE_TONE_CLASS: Record<TypeColorToken, string> = {
  brand: 'border-brand/30 bg-brand/12 text-brand',
  success: 'border-success/30 bg-success/12 text-success',
  warning: 'border-warning/30 bg-warning/12 text-warning',
  danger: 'border-danger/30 bg-danger/12 text-danger',
  muted: 'border-muted/25 bg-muted/12 text-muted',
}

function typeToneClass(column: string): string {
  return TYPE_TONE_CLASS[typeColorTokenOf(typeOf(column))]
}

/** 该列是不是来源表的主键（大小写不敏感：各库对未加引号的标识符处理不同） */
const primaryKeys = ref<Set<string>>(new Set())

function isPrimaryKey(column: string): boolean {
  return primaryKeys.value.has(column.toLowerCase())
}

/**
 * 主键查询的输入指纹。
 *
 * 不能直接 watch `props.source`：它是对象，父组件每次渲染都是新的引用 ——
 * 那样每渲染一次就查一次。摊平成字符串后，内容没变就不会触发。
 */
const sourceKey = computed(() => {
  const source = props.source
  return source
    ? [source.connId, source.database, source.dbType, source.sql].join('\u0000')
    : ''
})

/*
 * 只在「换了结果 / 换了连接或库」时查一次主键。
 * 查询本身带缓存（rowSql.fetchPrimaryKeys），翻页与重渲染都不会再打库；
 * 用递增序号丢弃过期响应 —— 连续执行两条查询时，先回来的旧结果不能盖掉新的。
 */
let primaryKeyRequest = 0
watch(sourceKey, async () => {
  const token = ++primaryKeyRequest
  const source = props.source
  const keys = source ? await primaryKeysOfResult(source) : []
  if (token === primaryKeyRequest) {
    primaryKeys.value = new Set(keys.map(key => key.toLowerCase()))
  }
}, { immediate: true })
</script>

<template>
  <!-- selectable：允许选中表头与单元格文本，便于 Ctrl+C 复制 -->
  <div class="result-table selectable flex h-full flex-col">
    <!--
      选区提示条：多选靠快捷键，不提示基本没人知道。
      顺带给一个「取消选择」的出口（Esc 也行，但藏在快捷键里不算出口）。
    -->
    <div
      v-if="selectedCount"
      class="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 px-1 pb-1 text-xs text-muted"
    >
      <span class="font-semibold text-brand">已选 {{ selectedCount }} 行</span>
      <span>· Ctrl 加选、Shift 连选、Ctrl+A 全选</span>
      <span>· Ctrl+C 复制为 CSV（含列名）、右键批量生成 SQL</span>
      <Button variant="ghost" size="sm" class="ml-auto" @click="clearSelection">
        取消选择
      </Button>
    </div>

    <DataTable
      v-model:selected="selectedRows"
      selectable
      select-text-on-dbl-click
      :columns="tableColumns"
      :rows="result.rows"
      :index-of="rowIndex"
      size="sm"
      striped
      class="min-h-0 flex-1"
      empty-text="查询成功，但未返回数据"
      @row-contextmenu="handleRowContextMenu"
      @copy-rows="handleCopyRows"
    >
      <!--
        列头三行：主键标识 + 列名 / 类型 / 备注（类型与描述各自独占一行）。
        层次靠三件事拉开（顺序即重要程度）：颜色（列名走正文色，元信息浅色）、
        字重、字号（元信息小两档）；类型再给一个按大类着色的药丸，
        扫一眼就能分清数值 / 文本 / 时间。每行各自截断。
        悬停提示走富卡片（data-col-*，见 utils/tooltip.ts），不再用纯文本 title。
      -->
      <template v-for="col in tableColumns" :key="`head-${col.key}`" #[`header-${col.key}`]>
        <div
          class="result-table__head"
          :class="{
            'result-table__head--right': col.align === 'right',
            'result-table__head--center': col.align === 'center',
          }"
          :data-col-name="col.label"
          :data-col-type="typeOf(col.key) || undefined"
          :data-col-table="tableOf(col.key) || undefined"
          :data-col-comment="commentOf(col.key) || undefined"
        >
          <span class="result-table__head-main">
            <Icon
              v-if="isPrimaryKey(col.key)"
              name="key"
              class="result-table__head-pk"
              title="主键"
            />
            <span class="result-table__head-name">{{ col.label }}</span>
          </span>
          <span v-if="typeOf(col.key)" class="result-table__head-meta">
            <span class="result-table__head-type" :class="typeToneClass(col.key)">
              {{ typeOf(col.key) }}
            </span>
          </span>
          <span v-if="commentOf(col.key)" class="result-table__head-meta">
            {{ commentOf(col.key) }}
          </span>
        </div>
      </template>

      <!--
        单元格。
        这里用「单元素数组的 v-for」给渲染结果起个别名：一格里只算一次。
        旧代码在同一个格子里把 renderCell 调了三次（判断 tip、判断 matched、取文本），
        而 EXPLAIN 的建议解析并不便宜 —— 大结果集下这是白烧 CPU。
      -->
      <template v-for="col in tableColumns" :key="`cell-${col.key}`" #[`cell-${col.key}`]="{ row }">
        <template v-for="cell in [renderCell(row, col.key)]" :key="0">
          <span
            v-if="cell.tooltip"
            class="result-table__cell"
            :class="{ 'result-table__cell--matched': cell.matched }"
            :title="cell.tooltip"
          >{{ cell.text }}</span>
          <span
            v-else
            class="result-table__cell"
            :class="{ 'result-table__cell--matched': cell.matched }"
          >{{ cell.text }}</span>
        </template>
      </template>
    </DataTable>
  </div>
</template>

<style scoped>
.result-table {
  flex: 1;
  min-height: 0;
  padding: 0 16px 12px;
}

/*
 * 列头整体：纵向两行。
 * 对齐跟随列的 align（表头单元格的 text-align 对 flex 子项无效，所以显式给）。
 */
.result-table__head {
  display: flex;
  flex-direction: column;
  gap: 1px;
  align-items: flex-start;
  min-width: 0;
}

.result-table__head--center {
  align-items: center;
}

.result-table__head--right {
  align-items: flex-end;
}

/* 两行内部都按行排：主键标识与列名一行、类型药丸与备注一行 */
.result-table__head-main,
.result-table__head-meta {
  display: flex;
  gap: 4px;
  align-items: center;
  max-width: 100%;
  min-width: 0;
}

/*
 * 列名是表头的主体：正文色 + 加粗 + 比元信息大两档的字号。
 * 表头单元格默认是 text-muted（次级信息色），这里必须显式提回正文色 ——
 * 否则「类型 / 备注」弱化后，列名跟它们仍在一个层次上，主次看不出来。
 */
.result-table__head-name {
  overflow: hidden;
  color: var(--text-color);
  font-size: var(--app-font-size-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 主键标识：钥匙用金色（通用隐喻），不跟着列名变色 */
.result-table__head-pk {
  flex: none;
  color: var(--warning-color);
}

/*
 * 元信息（类型 / 备注）：各自独占一行，比列名小两档、颜色继续弱化。
 * 字号必须走主题变量，否则「设置 → 外观 → 缩放比例」对它们无效。
 */
.result-table__head-meta {
  max-width: 100%;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--app-font-size-2xs);
  font-weight: 400;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 类型药丸：淡底 + 描边（配色见脚本里的 TYPE_TONE_CLASS，语义来自 typeBadge）。
 *
 * 描边刻意分开写 width / style 而不用 `border` 简写：简写会把颜色重置成
 * currentColor，而颜色是上面那些工具类给的 —— 谁在后就看打包顺序，太脆。
 */
.result-table__head-type {
  padding: 0 4px;
  border-width: 1px;
  border-style: solid;
  border-radius: 3px;
  font-weight: 500;
}

.result-table__cell {
  cursor: help;
}

.result-table__cell--matched {
  color: var(--brand-color);
}
</style>
