<script setup lang="ts">
/**
 * 复选框（替代 `el-checkbox`）。
 *
 * 自绘而不是直接用原生 checkbox：原生控件的勾选框由系统绘制，四套主题下样式不可控
 * （`accent-color` 只能改填充色，尺寸 / 圆角 / 对勾都碰不到）。
 *
 * 真正的 `<input type="checkbox">` 仍留在 DOM 里（`sr-only`，视觉上由内层方块承担），
 * 于是键盘可达、读屏语义正确，`v-model` 也是原生行为。
 */
import { cn } from '@/lib/utils'
import Icon from '@/components/ui/Icon.vue'

const props = withDefaults(defineProps<{
  disabled?: boolean
  class?: string
}>(), {})

const model = defineModel<boolean>({ default: false })
</script>

<template>
  <label
    :class="cn(
      'inline-flex cursor-pointer items-center gap-2 text-sm text-text select-none',
      disabled && 'cursor-not-allowed opacity-50',
      props.class,
    )"
  >
    <input v-model="model" type="checkbox" :disabled="disabled" class="peer sr-only">
    <span
      class="flex size-[15px] shrink-0 items-center justify-center rounded border border-border
        bg-surface transition-colors peer-checked:border-brand peer-checked:bg-brand
        peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-accent"
    >
      <Icon v-if="model" name="check" class="text-2xs text-white" />
    </span>
    <slot />
  </label>
</template>
