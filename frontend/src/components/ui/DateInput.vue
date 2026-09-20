<script setup lang="ts">
/**
 * 日期选择（替代 `el-date-picker`）。
 *
 * 用原生 `<input type="date">`：值格式本来就是 `YYYY-MM-DD`，与后端 / 模板里
 * 存的字符串格式**完全一致**（旧代码靠 `value-format="YYYY-MM-DD"` 转成这个格式，
 * 现在省掉这层转换），也不引入日历浮层的定位与键盘逻辑。
 * 外观与 Input 对齐：同样的高度、边框、焦点态。
 */
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  disabled?: boolean
  class?: string
}>(), {})

const model = defineModel<string>({ default: '' })
</script>

<template>
  <input
    v-model="model"
    type="date"
    :disabled="disabled"
    :class="cn(
      'h-[calc(32px*var(--app-control-scale))] w-full rounded-md border border-border bg-surface',
      'px-2.5 text-sm text-text transition-colors outline-none',
      'hover:border-brand/40 focus:border-brand/60 disabled:cursor-not-allowed disabled:opacity-50',
      props.class,
    )"
  >
</template>
