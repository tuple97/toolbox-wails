<script setup lang="ts">
/**
 * 空状态（替代 `el-empty`）。
 *
 * 只画一个极简的「空托盘」图标 + 一句说明：这类占位出现在结果区、列表区，
 * 本来就没有数据，不该再画得比数据本身还显眼。
 * 需要「去做点什么」的入口时用默认插槽塞按钮。
 */
import { cn } from '@/lib/utils'
import Icon from '@/components/ui/Icon.vue'

defineProps<{
  /** 说明文案：说清「为什么这里是空的」，不要只写「暂无数据」 */
  description?: string
  class?: string
}>()
</script>

<template>
  <div :class="cn('flex h-full flex-col items-center justify-center gap-2 px-4 py-8', $props.class)">
    <Icon name="inbox" class="text-4xl text-muted opacity-60" />
    <p v-if="description" class="text-center text-sm text-muted">
      {{ description }}
    </p>
    <slot />
  </div>
</template>
