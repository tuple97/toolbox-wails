<script setup lang="ts">
/**
 * 自绘图标（替代 `@element-plus/icons-vue` + `<el-icon>`）。
 *
 * 尺寸用 `1em`：跟着父级字号走 —— 与旧的 `<el-icon>` 行为一致，于是旧样式里
 * 那些靠 `font-size` 控制图标大小的规则（`.app-sidebar__icon` 之类）不用改一行。
 * 要单独调大小就给它 Tailwind 字号类（`text-lg`）或 `size-5`。
 *
 * 根节点恒定带 `app-icon` 类：迁移期间样式里 `.xxx .el-icon` 的选择器
 * 统一改成 `.xxx .app-icon` 即可。
 */
import { computed } from 'vue'
import { cn } from '@/lib/utils'
import { iconBody } from '@/utils/icons'

const props = defineProps<{
  /** 图标名（见 utils/icons.ts；拼错会渲染成问号并在开发期告警） */
  name: string
  /** 追加类：尺寸 / 颜色 / 间距等 */
  class?: string
}>()

/*
 * 用 v-html 注入：图标内容是本仓库自带的静态字符串（utils/icons.ts），
 * 不含任何用户输入，因此没有注入面；换来的是图标库可以纯声明式地维护。
 */
const body = computed(() => iconBody(props.name))
</script>

<template>
  <svg
    class="app-icon"
    :class="cn('inline-block size-[1em] shrink-0 align-[-0.15em]', props.class)"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="body"
  />
</template>
