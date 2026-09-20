<script setup lang="ts" generic="TRow extends object">
/**
 * 数据表（替代 `el-table` + `el-table-column`）。
 *
 * 列是**数据**（`columns` 数组）而不是子组件。EP 的声明式写法要靠插槽里的
 * `$index` / `row` 反查，列一多就难读；而这里几处调用方（查询结果集、脚本摘要、
 * 元数据、词典条目）的列本来就是运行时算出来的，数组形式能直接 `computed`，
 * 也让「列宽 / 对齐 / 是否截断」变成可测的配置（见 utils/tableLayout.ts）。
 *
 * 行类型是**泛型**：调用方传自己的记录类型（`StatementRunRecord` 这种 interface），
 * 单元格插槽里 `row` 就有完整推断。约束用 `object` 而不是 `Record<string, unknown>`
 * —— interface 没有索引签名，约束成 Record 会让所有正常调用方编译不过。
 *
 * 内容渲染：
 *  - `#cell-<key>` 插槽（`{ row, index }`）：自定义单元格（可编辑表格用它塞 Input）；
 *  - `#header-<key>` 插槽（`{ column }`）：自定义表头（结果集的三行表头就是它）；
 *  - 两者都不给就按 `row[key]` 渲染纯文本；`ellipsis` 列的全文走 `title`（应用内小提示）。
 *
 * 宽度：`width` 固定像素；没给 `width` 的列按 `minWidth`（默认 120）**按比例分**
 * 剩余空间 —— 比「平均分」更贴近 EP `min-width` 的观感（注释长的列更宽）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { cn } from '@/lib/utils'
import EmptyState from '@/components/ui/EmptyState.vue'
import { applyRowSelection } from '@/utils/rowSelection'
import { alignClassOf, cellTextOf, columnWidthStyle, tableMinWidthOf } from '@/utils/tableLayout'
import type { TableColumn } from '@/utils/tableLayout'

const props = withDefaults(defineProps<{
  columns: TableColumn[]
  /** 行数据：类型由调用方决定（泛型 TRow） */
  rows: TRow[]
  /** 行号列：给了才渲染 `#` 列（结果集的跨页连续编号由它算） */
  indexOf?: (index: number) => number
  /** 行号列宽度（默认 64） */
  indexWidth?: number
  /** 无数据时的说明 */
  emptyText?: string
  /** 隔行底色（对齐 EP 的 stripe） */
  striped?: boolean
  /** 紧凑尺寸：结果日志、元数据这类表用 */
  size?: 'sm' | 'default'
  /**
   * 开启行选择：普通点击单选、Ctrl / Cmd 加减选、Shift 区间选，
   * 选择结果走 `v-model:selected`（行下标），右键时随事件带回**所有选中行**。
   */
  selectable?: boolean
  /**
   * 双击单元格时选中该格的**文本**（数据表格的通行做法：
   * 双击即拿到整个值，比原生的「选中一个词」贴合复制单元格的用途）。
   * 只读表格开；可编辑表格（格子里是输入框）不要开。
   */
  selectTextOnDblClick?: boolean
  class?: string
}>(), {
  emptyText: '暂无数据',
  size: 'default',
  indexWidth: 64,
})

const emit = defineEmits<{
  (e: 'row-contextmenu', payload: {
    /** 被右键的那一行 */
    row: TRow
    index: number
    /** 本次操作实际要作用的行：多选且点命中了选区时是全部选中行，否则只有 `row` */
    rows: TRow[]
    x: number
    y: number
  }): void
  /**
   * 按 Ctrl / Cmd + C 且**当前没有选中文本**时触发：调用方把选中行复制走
   * （结果表格复制成 CSV）。有文本选中时不触发，让浏览器照常复制文本。
   */
  (e: 'copy-rows', payload: { rows: TRow[] }): void
}>()

/*
 * 显式声明插槽类型：单元格 / 表头插槽的名字里带列键（`cell-<key>`），
 * 不写这段时模板里的「动态插槽名 + v-for 变量」会让 vue-tsc 把变量推成 any
 * 循环引用（TS7022）—— 插槽类型从调用处反推，而调用处又用到那个变量。
 */
defineSlots<{
  [name: `cell-${string}`]: (props: { row: TRow, index: number }) => unknown
  [name: `header-${string}`]: (props: { column: TableColumn }) => unknown
  default?: () => unknown
}>()

/** 单元格文本：行类型交给调用方（这里只需按键取值），缺键返回空串 */
function cellText(row: TRow, col: TableColumn): string {
  return cellTextOf(row as Record<string, unknown>, col)
}

/**
 * 表格的最小总宽度。
 *
 * 列宽是「按容器宽度算百分比」的，所以表格本身必须有一个下限，否则列会被
 * 无限压缩去凑容器 —— 列一多就全挤在一起、文字被截成一条缝。
 * 取 `max(容器宽度, 最小总宽度)`：装得下就铺满，装不下就横向滚动（对齐 el-table 的行为）。
 */
const minTableWidth = computed(() =>
  tableMinWidthOf(props.columns, props.indexOf ? props.indexWidth : 0))

/*
 * 行选择（`selectable` 开启时生效）：普通点击单选、Ctrl / Cmd 加减选、Shift 区间选。
 * 规则本身在 utils/rowSelection.ts（纯函数 + 用例），这里只负责「事件 → 规则」的接线。
 */
const selected = defineModel<number[]>('selected', { default: () => [] })
/** 区间选择的锚点：上一次「非 Shift」点击落在哪一行 */
const anchorIndex = ref<number | null>(null)
/**
 * 滚动容器（键盘事件的落点）。
 *
 * 行本身不可聚焦，键盘事件必须有地方接：把容器设为 `tabindex="-1"`，
 * 点行时主动 `focus()`，于是 Ctrl+A / Ctrl+C 只在**焦点在表格里**时生效 ——
 * 不会抢走 SQL 编辑器的 Ctrl+A（那是选中全部代码）。
 */
const container = ref<HTMLElement | null>(null)

function isSelected(index: number): boolean {
  return props.selectable === true && selected.value.includes(index)
}

function handleRowClick(index: number, event: MouseEvent) {
  /*
   * 表格内已经有文本选中时不要改行选择：这说明用户刚才在**拖选文字**
   * （拖动结束时浏览器会补一个 click）。两套选择各管各的，
   * 不然「拖选一段文字」会顺手把那一行也选上，接着 Ctrl+C 复制什么就说不清了。
   */
  if (hasTextSelectionInside()) {
    return
  }
  const next = applyRowSelection({
    current: selected.value,
    clicked: index,
    shift: event.shiftKey,
    toggle: event.ctrlKey || event.metaKey,
    anchor: anchorIndex.value,
  })
  selected.value = next.selected
  anchorIndex.value = next.anchor
}

/** 当前是否有「落在表格内的」文本选中（表格外的选区与本组件无关） */
function hasTextSelectionInside(): boolean {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.anchorNode) {
    return false
  }
  return container.value?.contains(selection.anchorNode) ?? false
}

/**
 * 行上按下鼠标：拿到焦点，并在 Shift 时**阻止原生文本选择**。
 *
 * 为什么要在 mousedown 上拦：浏览器的「按住 Shift 拖选文字」是从这里开始的，
 * 只在 click 上处理已经晚了 —— 那时文字早被选中，Ctrl+C 就会去复制文本而不是行。
 * 阻止默认行为不影响 click 事件本身，行的加减选照常。
 */
function handleRowMouseDown(event: MouseEvent) {
  if (!props.selectable) {
    return
  }
  container.value?.focus({ preventScroll: true })
  if (event.shiftKey) {
    event.preventDefault()
    // 顺手清掉可能残留的旧选区：Shift 选行之后按 Ctrl+C，语义必须唯一
    window.getSelection()?.removeAllRanges()
  }
}

/** 全选（Ctrl / Cmd + A） */
function selectAll() {
  selected.value = props.rows.map((_, index) => index)
  anchorIndex.value = props.rows.length ? props.rows.length - 1 : null
}

/** 表格里的快捷键：只在焦点位于表格内时收到（见 container 注释） */
function handleTableKeydown(event: KeyboardEvent) {
  if (!props.selectable || !(event.ctrlKey || event.metaKey)) {
    return
  }
  const key = event.key.toLowerCase()
  if (key === 'a') {
    event.preventDefault()
    selectAll()
    return
  }
  if (key === 'c') {
    // 有文本选中 → 交给浏览器复制文本；没有 → 复制选中行（调用方决定格式）
    const textSelection = window.getSelection()
    if (textSelection && !textSelection.isCollapsed) {
      return
    }
    if (!selected.value.length) {
      return
    }
    event.preventDefault()
    emit('copy-rows', {
      rows: selected.value
        .map(index => props.rows[index])
        .filter((row): row is TRow => row !== undefined),
    })
  }
}

/** 双击选中整个单元格的文本（开 `selectTextOnDblClick` 时） */
function handleCellDblClick(event: MouseEvent) {
  if (!props.selectTextOnDblClick) {
    return
  }
  const target = event.target as HTMLElement | null
  // 可编辑表格的格子里是输入框：别抢它的双击选词
  if (!target || target.closest('input, textarea, select')) {
    return
  }
  const cell = target.closest('td')
  const selection = window.getSelection()
  if (!cell || !selection) {
    return
  }
  const range = document.createRange()
  range.selectNodeContents(cell)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** 清空选择（点到空白处 / 按 Esc / 换了数据集） */
function clearSelection() {
  if (selected.value.length) {
    selected.value = []
  }
  anchorIndex.value = null
}

/*
 * 换了数据（新查询、翻页）就清空选择：行下标已经指向别的行了，
 * 留着选择不但没用，还会让下一次批量操作作用在意料之外的行上。
 */
watch(() => props.rows, () => clearSelection())

/* Esc 清空选择：不 preventDefault —— 不抢其它 Esc 处理（如关闭弹窗） */
function handleEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && selected.value.length) {
    clearSelection()
  }
}
document.addEventListener('keydown', handleEscape)
onBeforeUnmount(() => document.removeEventListener('keydown', handleEscape))

function onRowContextMenu(row: TRow, index: number, event: MouseEvent) {
  /*
   * 右键的作用范围 = 当前选区，但只有当被点的行**在选区内**时才算批量；
   * 点在选区外就先改成只选这一行 —— 与桌面软件的直觉一致：
   * 右键某一行，不应该连带对之前选中的其它行动手。
   */
  if (props.selectable && !selected.value.includes(index)) {
    selected.value = [index]
    anchorIndex.value = index
  }
  const rows = props.selectable && selected.value.length
    ? selected.value
        .map(item => props.rows[item])
        .filter((item): item is TRow => item !== undefined)
    : [row]
  emit('row-contextmenu', { row, index, rows, x: event.clientX, y: event.clientY })
}
</script>

<template>
  <div :class="cn('flex min-h-0 flex-col overflow-hidden', props.class)">
    <!--
      键盘快捷键的落点（Ctrl+A 全选 / Ctrl+C 复制选中行）：
      设 tabindex 让容器可聚焦，点行时主动 focus —— 焦点不在表格里时
      这些快捷键不生效，于是不会抢 SQL 编辑器的 Ctrl+A。
      outline-none：焦点只用于收键盘事件，不该画出焦点框。
    -->
    <div
      ref="container"
      tabindex="-1"
      class="min-h-0 flex-1 overflow-auto outline-none"
      @keydown="handleTableKeydown"
      @click.self="selectable && clearSelection()"
    >
      <table
        v-if="rows.length"
        class="w-full table-fixed border-collapse text-sm"
        :style="{ minWidth: `${minTableWidth}px` }"
      >
        <colgroup>
          <col v-if="indexOf" :style="{ width: `${indexWidth}px` }">
          <col v-for="col in columns" :key="col.key" :style="columnWidthStyle(col, columns)">
        </colgroup>

        <thead class="sticky top-0 z-10">
          <tr class="bg-panel">
            <th
              v-if="indexOf"
              :class="cn(
                'border-b border-r border-border px-2 font-medium text-muted',
                size === 'sm' ? 'py-1 text-xs' : 'py-1.5',
              )"
            >
              #
            </th>
            <th
              v-for="(col, columnIndex) in columns"
              :key="col.key"
              :class="cn(
                'border-b border-border px-2 font-medium text-muted',
                columnIndex < columns.length - 1 && 'border-r',
                size === 'sm' ? 'py-1 text-xs' : 'py-1.5',
                alignClassOf(col),
              )"
            >
              <slot :name="`header-${col.key}`" :column="col">{{ col.label }}</slot>
            </th>
          </tr>
        </thead>

        <tbody>
          <tr
            v-for="(row, index) in rows"
            :key="index"
            :class="cn(
              'border-b border-border last:border-b-0',
              striped && index % 2 === 1 && 'bg-surface/40',
              // 选中态放在斑马纹之后：选中行必须盖过隔行底色，否则看不出来选了哪几行
              isSelected(index) && 'bg-active',
            )"
            @mousedown="handleRowMouseDown($event)"
            @click="selectable && handleRowClick(index, $event)"
            @contextmenu="onRowContextMenu(row, index, $event)"
          >
            <td
              v-if="indexOf"
              :class="cn(
                'overflow-hidden border-r border-border px-2 text-center text-muted',
                size === 'sm' ? 'py-0.5 text-xs' : 'py-1',
              )"
            >
              {{ indexOf(index) }}
            </td>
            <td
              v-for="(col, columnIndex) in columns"
              :key="col.key"
              :class="cn(
                'overflow-hidden border-border px-2 align-middle',
                columnIndex < columns.length - 1 && 'border-r',
                size === 'sm' ? 'py-0.5 text-xs' : 'py-1',
                alignClassOf(col),
              )"
              @dblclick="handleCellDblClick"
            >
              <slot v-if="$slots[`cell-${col.key}`]" :name="`cell-${col.key}`" :row="row" :index="index" />
              <div
                v-else
                :class="col.ellipsis && 'truncate'"
                :title="col.ellipsis ? cellText(row, col) : undefined"
              >
                {{ cellText(row, col) }}
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- 空表：说明文字用调用方给的（「查询成功但没返回数据」比「暂无数据」有用） -->
      <EmptyState v-else :description="emptyText" />
    </div>
  </div>
</template>
