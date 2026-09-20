<script setup lang="ts">
/**
 * 对话框（替代 `el-dialog`）。
 *
 * 只保留项目用得到的一档：居中弹窗 + 标题行 + 关闭按钮，内容与页脚走插槽。
 * 行为按项目已有的浮层约定收窄：
 *  - Teleport 到 body + 固定定位：不被父级的 overflow / transform 裁切；
 *  - Esc 与点击遮罩都关闭（Element Plus 的默认行为，不另立一套）；
 *  - 打开时锁住 body 滚动、关闭后还原（否则底下的长列表会跟着滚）；
 *  - 底色用 `--overlay-bg`、遮罩用 `--app-mask`：各主题自动跟随，不需要每个页面自己写。
 */
import { onBeforeUnmount, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'

const props = withDefaults(defineProps<{
  /** 是否显示（v-model） */
  modelValue: boolean
  title?: string
  /** 面板宽度：数字按 px，字符串原样（如 '60vw'） */
  width?: number | string
  /** 点遮罩是否关闭 */
  closeOnMask?: boolean
}>(), {
  title: '',
  width: 520,
  closeOnMask: true,
})

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

/** 关闭：只往上抛事件，状态仍由调用方的 v-model 持有（单一数据源） */
function close() {
  emit('update:modelValue', false)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    // 弹窗优先吃 Esc：不让它冒到全局快捷键（如执行器的「停止」）
    event.stopPropagation()
    close()
  }
}

watch(() => props.modelValue, (open) => {
  if (open) {
    window.addEventListener('keydown', handleKeydown)
    document.body.style.overflow = 'hidden'
    return
  }
  window.removeEventListener('keydown', handleKeydown)
  document.body.style.overflow = ''
}, { immediate: true })

// 组件被卸载（如所在标签页关闭）时也要还原，否则 body 会永久锁滚动
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="app-dialog">
      <div v-if="modelValue" class="app-dialog fixed inset-0 z-[9990] flex items-center justify-center p-6">
        <div class="absolute inset-0 bg-[var(--app-mask)]" @click="closeOnMask && close()" />

        <div
          class="app-dialog__panel relative z-10 flex max-h-[85vh] w-full flex-col overflow-hidden
            rounded-lg border border-border bg-overlay shadow-panel"
          :style="{ width: typeof width === 'number' ? `${width}px` : width }"
          role="dialog"
          aria-modal="true"
        >
          <header class="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <h3 class="text-sm font-semibold text-text">
              {{ title }}
            </h3>
            <button
              type="button"
              class="ml-auto inline-flex size-6 items-center justify-center rounded-md
                text-muted transition-colors hover:bg-hover hover:text-text"
              title="关闭"
              @click="close"
            >
              <Icon name="close" />
            </button>
          </header>

          <div class="flex-1 overflow-auto px-4 py-3 text-text">
            <slot />
          </div>

          <footer
            v-if="$slots.footer"
            class="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5"
          >
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.app-dialog-enter-active,
.app-dialog-leave-active {
  transition: opacity 0.15s ease;
}

.app-dialog-enter-active .app-dialog__panel,
.app-dialog-leave-active .app-dialog__panel {
  transition: transform 0.15s ease;
}

.app-dialog-enter-from,
.app-dialog-leave-to {
  opacity: 0;
}

.app-dialog-enter-from .app-dialog__panel,
.app-dialog-leave-to .app-dialog__panel {
  transform: scale(0.97);
}
</style>
