<script setup lang="ts">
import { computed } from 'vue'
import Combobox from '@/components/ui/Combobox.vue'
import ConnectionOption from '@/components/ConnectionOption.vue'
import { connectionOptionLabel } from '@/utils/connectionDisplay'
import type { DBConnection } from '@/types'

/**
 * 数据源（数据库连接）下拉。
 *
 * 下拉项与**选中项**共用 `ConnectionOption` 渲染，样式完全一致：
 * 选完之后看到的就是列表里的那一行（色点 + 名称 + 环境标签 + 只读标签），
 * 而不是只剩一句纯文本。
 *
 * 各处需要「选连接」时都用它，避免每个页面各写一套下拉。
 *
 * 值在组件内部是**字符串**（Combobox 承载的是「值」，统一用 string 做 v-model），
 * 对外仍是 `number | null` —— 转换只在这一处，调用方不受影响。
 */
const props = withDefaults(defineProps<{
  /** 选中的连接 ID；null 表示未选择 */
  modelValue: number | null
  /** 可选连接列表 */
  connections: DBConnection[]
  placeholder?: string
  /** 是否可清空 */
  clearable?: boolean
  /** 是否允许输入过滤 */
  filterable?: boolean
  /** 宽度；不传时由外部样式（class）决定 */
  width?: string
}>(), {
  placeholder: '选择数据库连接',
  clearable: false,
  filterable: true,
  width: '',
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: number | null): void
}>()

/** 双向绑定：空串 ↔ null，其余按数字传出去 */
const selected = computed({
  get: () => (props.modelValue === null ? '' : String(props.modelValue)),
  set: (value: string) => emit('update:modelValue', value === '' ? null : Number(value)),
})

/** 选项：值为连接 id，label 供搜索匹配（列表里显示的是 ConnectionOption 那一行） */
const options = computed(() => props.connections.map(conn => ({
  label: connectionOptionLabel(conn),
  value: String(conn.id),
})))

/** 按选项值取连接对象（`#option` / `#value` 插槽据此渲染） */
function connectionOf(value: string): DBConnection | null {
  return props.connections.find(conn => String(conn.id) === value) ?? null
}
</script>

<template>
  <Combobox
    v-model="selected"
    :options="options"
    :placeholder="placeholder"
    :clearable="clearable"
    :filterable="filterable"
    search-placeholder="搜索连接…"
    :style="width ? { width } : undefined"
  >
    <!-- 选中项：与下拉项同样的色点 + 环境标签 + 只读标签（w-full 让「类型」贴到最右） -->
    <template #value="{ option }">
      <ConnectionOption
        v-if="connectionOf(option.value)"
        class="w-full"
        :connection="connectionOf(option.value) as DBConnection"
      />
    </template>

    <template #option="{ option }">
      <ConnectionOption
        v-if="connectionOf(option.value)"
        class="w-full"
        :connection="connectionOf(option.value) as DBConnection"
      />
    </template>
  </Combobox>
</template>
