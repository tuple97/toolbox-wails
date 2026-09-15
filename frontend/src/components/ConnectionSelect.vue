<script setup lang="ts">
import { computed } from 'vue'
import ConnectionOption from '@/components/ConnectionOption.vue'
import { connectionOptionLabel } from '@/utils/connectionDisplay'
import type { DBConnection } from '@/types'

/**
 * 数据源（数据库连接）下拉。
 *
 * 下拉项与**选中项**共用 `ConnectionOption` 渲染，样式完全一致：
 * 选中项走 Element Plus 的 `label` 插槽（2.7.4+，本项目 2.14.5 可用），
 * 否则选中后只会显示纯文本 label，与下拉里的色点/标签对不上。
 *
 * 各处需要「选连接」时都用它，避免每个页面各写一套下拉。
 */

const props = withDefaults(defineProps<{
  /** 选中的连接 ID */
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

/** 双向绑定；清空时统一归为 null */
const selected = computed({
  get: () => props.modelValue,
  set: (value: number | null | undefined) => emit('update:modelValue', value ?? null),
})

/** 选中项对应的连接对象；据此渲染与下拉一致的选中样式 */
const selectedConnection = computed(
  () => props.connections.find(item => item.id === selected.value) ?? null,
)
</script>

<template>
  <el-select
    v-model="selected"
    :placeholder="placeholder"
    :clearable="clearable"
    :filterable="filterable"
    :style="width ? { width } : undefined"
  >
    <!-- 选中项：与下拉项同样的色点 + 环境标签 + 只读标签 -->
    <template #label>
      <ConnectionOption v-if="selectedConnection" :connection="selectedConnection" />
    </template>

    <el-option
      v-for="conn in connections"
      :key="conn.id"
      :label="connectionOptionLabel(conn)"
      :value="conn.id"
    >
      <ConnectionOption :connection="conn" />
    </el-option>
  </el-select>
</template>
