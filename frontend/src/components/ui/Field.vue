<script setup lang="ts">
/**
 * 设置项的一行：左侧标签、右侧控件、下方说明。
 *
 * 取代 Element Plus 的 `el-form-item`：标签宽度固定（设置页各行的控件左缘对齐），
 * 说明文字直接挂在控件下方（比原来单独占一个空标签的表单行更紧凑，也更容易读）。
 */
defineProps<{
  label?: string
  /** 说明文字：解释这个开关/选项的作用 */
  hint?: string
  /** 必填标记（替代 `el-form-item` 的 `required`，只做视觉提示） */
  required?: boolean
  /**
   * 标签列宽（默认 7rem）。
   * 密排的表单面板（变量配置 / 字段映射）用 76px 这种更窄的值，
   * 免得标签列吃掉一半宽度。
   */
  labelWidth?: string
}>()
</script>

<template>
  <div class="flex items-start gap-3 py-2">
    <span
      v-if="label"
      class="shrink-0 pt-1.5 text-sm text-muted"
      :style="{ width: labelWidth ?? '7rem' }"
    >
      {{ label }}<span v-if="required" class="ml-0.5 text-danger">*</span>
    </span>
    <div class="min-w-0 flex-1">
      <slot />
      <p v-if="hint" class="mt-1.5 text-xs leading-relaxed text-muted">
        {{ hint }}
      </p>
    </div>
  </div>
</template>
