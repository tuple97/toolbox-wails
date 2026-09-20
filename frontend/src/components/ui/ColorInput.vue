<script setup lang="ts">
/**
 * 颜色选择（替代 `el-color-picker`）。
 *
 * 直接用原生 `<input type="color">`：它唤起的是系统取色器，取色精度与习惯都好过
 * 自绘面板，而且不需要为「点击外部关闭 / 拖拽调和 / 键盘操作」再写一套浮层逻辑。
 * 应用这边只负责外观（方形色块 + 十六进制值），并让取色器弹窗里的色板贴合圆角。
 *
 * 值格式就是 `#rrggbb`（小写），与配置里存的格式一致。
 */
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  disabled?: boolean
  class?: string
}>(), {})

const model = defineModel<string>({ default: '#000000' })
</script>

<template>
  <label
    :class="cn('inline-flex items-center gap-2', disabled && 'cursor-not-allowed opacity-50', props.class)"
  >
    <input
      v-model="model"
      type="color"
      :disabled="disabled"
      class="size-[calc(28px*var(--app-control-scale))] shrink-0 cursor-pointer rounded-md
        border border-border bg-surface p-0.5"
    >
    <code class="text-xs text-muted">{{ model }}</code>
  </label>
</template>

<style scoped>
/* 原生色块自带内边距与直角，跟应用里的圆角控件对不上，这里抹平 */
input[type='color']::-webkit-color-swatch-wrapper {
  padding: 0;
}

input[type='color']::-webkit-color-swatch {
  border: none;
  border-radius: 3px;
}
</style>
