<script setup lang="ts">
/**
 * 按钮。
 *
 * 变体用 `cva` 管理（shadcn 的做法）：颜色只引用语义令牌
 * （`bg-brand` / `text-muted` / `border-border` …），换主题不用改组件。
 * 高度乘 `--app-control-scale`，与「设置 → 控件大小」保持一致；
 * 字号用 Tailwind 阶梯（挂在「基准 13px × 缩放比例」上，自动跟随）。
 */
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'default' | 'lg' | 'icon'
  disabled?: boolean
  /** 载入中：显示转圈并禁用（对应 EP 的 loading，避免重复提交） */
  loading?: boolean
  /** 原生按钮类型：表单里默认 button，避免误触发表单提交 */
  type?: 'button' | 'submit' | 'reset'
  class?: string
}>(), {
  variant: 'default',
  size: 'default',
  type: 'button',
})

const emit = defineEmits<{ (e: 'click', event: MouseEvent): void }>()

const button = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap '
  + 'transition-colors select-none disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-brand text-white hover:opacity-90',
        secondary: 'border border-border bg-surface text-text hover:bg-hover',
        outline: 'border border-border text-text hover:bg-hover',
        ghost: 'text-muted hover:bg-hover hover:text-text',
        danger: 'border border-danger/35 bg-danger/10 text-danger hover:bg-danger/20',
      },
      size: {
        sm: 'h-[calc(26px*var(--app-control-scale))] px-2 text-xs',
        default: 'h-[calc(32px*var(--app-control-scale))] px-3 text-sm',
        lg: 'h-[calc(38px*var(--app-control-scale))] px-4 text-base',
        icon: 'size-[calc(30px*var(--app-control-scale))]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :class="cn(button({ variant, size }), props.class)"
    @click="emit('click', $event)"
  >
    <!-- 转圈：用 border 拼一个环，靠 animate-spin 转，不额外引图标 -->
    <span
      v-if="loading"
      class="size-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
    <slot />
  </button>
</template>
