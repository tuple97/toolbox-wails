<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  closeWindow,
  isWindowMaximised,
  minimiseWindow,
  toggleMaximiseWindow,
} from '@/api/window'
import logoUrl from '@/assets/images/logo-universal.png'

withDefaults(defineProps<{
  /** 工具栏左侧显示的应用名称 */
  title?: string
}>(), {
  title: 'Toolbox',
})

const emit = defineEmits<{
  /** 点击设置按钮 */
  (e: 'settings'): void
  /** 点击 SQL 模板按钮 */
  (e: 'templates'): void
  /**
   * 在标题栏空白区域触发右键。
   * 系统菜单仅在此事件中弹出，其余区域不响应。
   */
  (e: 'context-menu', payload: { x: number, y: number }): void
}>()

/** 当前窗口是否最大化，用于切换按钮图标 */
const maximised = ref(false)

/**
 * 处理工具栏双击：切换最大化。
 *
 * 拖动交由 Wails 原生 CSS 拖动机制完成：
 * 工具栏上的 `--wails-draggable: drag` 会在 mousedown 时直接让系统接管拖动，
 * 且内置的 dragTest 在 e.detail !== 1（双击）时会跳过拖动，
 * 因此这里只需处理双击本身。
 */
function handleDoubleClick(event: MouseEvent) {
  if (!isBlankArea(event.target)) {
    return
  }
  event.preventDefault()
  toggleMaximiseWindow()
  window.setTimeout(syncMaximised, 60)
}

/** 同步窗口最大化状态 */
async function syncMaximised() {
  try {
    maximised.value = await isWindowMaximised()
  }
  catch {
    maximised.value = false
  }
}

/**
 * 判断事件目标是否为工具栏空白区域。
 * 系统右键菜单与拖动都只在标题栏空白处生效。
 */
function isBlankArea(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  return !target.closest('[data-no-drag]')
}

/**
 * 标题栏右键：弹出自定义系统菜单。
 * 仅当右击空白区域时响应，避免在按钮上误触发。
 */
function handleContextMenu(event: MouseEvent) {
  if (!isBlankArea(event.target)) {
    return
  }
  event.preventDefault()
  emit('context-menu', { x: event.clientX, y: event.clientY })
}

/** 最大化 / 还原后刷新按钮图标 */
function handleWindowResize() {
  void syncMaximised()
}

onMounted(() => {
  void syncMaximised()
  window.addEventListener('resize', handleWindowResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleWindowResize)
})
</script>

<template>
  <header
    class="titlebar"
    :class="{ 'titlebar--maximised': maximised }"
    @dblclick="handleDoubleClick"
    @contextmenu="handleContextMenu"
  >
    <!-- 应用标识：图标 + 名称 -->
    <div class="titlebar__brand">
      <img class="titlebar__logo" :src="logoUrl" alt="">
      <span class="titlebar__title">{{ title }}</span>
    </div>

    <!-- 中间可放置自定义内容（如标签页、工具按钮） -->
    <div class="titlebar__slot">
      <slot name="center" />
    </div>

    <!-- 窗口控制按钮 -->
    <div class="titlebar__controls" data-no-drag>
      <!-- SQL 模板管理 -->
      <button
        class="titlebar__btn"
        type="button"
        aria-label="SQL 模板"
        title="SQL 模板管理"
        @click="emit('templates')"
      >
        <el-icon><Document /></el-icon>
      </button>

      <!-- 设置 -->
      <button
        class="titlebar__btn"
        type="button"
        aria-label="设置"
        title="设置"
        @click="emit('settings')"
      >
        <el-icon><Setting /></el-icon>
      </button>

      <button
        class="titlebar__btn"
        type="button"
        aria-label="最小化"
        title="最小化"
        @click="minimiseWindow"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <rect x="2" y="5.5" width="8" height="1" rx="0.5" />
        </svg>
      </button>

      <button
        class="titlebar__btn"
        type="button"
        :aria-label="maximised ? '还原' : '最大化'"
        :title="maximised ? '还原' : '最大化'"
        @click="toggleMaximiseWindow(); syncMaximised()"
      >
        <svg v-if="!maximised" viewBox="0 0 12 12" aria-hidden="true">
          <rect x="2.5" y="2.5" width="7" height="7" rx="1" />
        </svg>
        <svg v-else viewBox="0 0 12 12" aria-hidden="true">
          <rect x="2" y="4" width="6" height="6" rx="1" />
          <path d="M4.5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H9" />
        </svg>
      </button>

      <button
        class="titlebar__btn titlebar__btn--close"
        type="button"
        aria-label="关闭"
        title="关闭"
        @click="closeWindow"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 3l6 6M9 3l-6 6" />
        </svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  position: relative;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  flex: 0 0 40px;
  padding-left: 12px;
  background: var(--titlebar-bg);
  border-bottom: 1px solid var(--border-color);
  backdrop-filter: blur(12px);
  user-select: none;
  -webkit-user-select: none;

  /*
   * 交给 Wails 原生机制处理拖动。
   * 这里刻意不声明 cursor：Wails 的边缘缩放把指针样式写在 html 的内联 style 上，
   * 任何针对标题栏的 cursor 声明都会覆盖它。
   */
  --wails-draggable: drag;
}

.titlebar__brand,
.titlebar__slot {
  display: flex;
  align-items: center;
  min-width: 0;
}

.titlebar__brand {
  gap: 8px;
}

.titlebar__logo {
  width: 18px;
  height: 18px;
  pointer-events: none;
  -webkit-user-drag: none;
}

.titlebar__title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: var(--text-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.titlebar__slot {
  flex: 1;
  height: 100%;
}

.titlebar__controls {
  display: flex;
  align-items: stretch;
  height: 100%;
  /* 按钮区域不参与拖动；同样不声明 cursor，保持边缘缩放指针可用 */
  --wails-draggable: no-drag;
}

.titlebar__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 15px;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

/* 窗口控制按钮使用内联 svg，统一线宽与尺寸 */
.titlebar__btn > svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.1;
}

/* Element Plus 图标按钮（模板、设置）保持字号大小 */
.titlebar__btn > .el-icon {
  font-size: 15px;
}

.titlebar__btn:focus-visible {
  outline: 1px solid var(--brand-color);
  outline-offset: -2px;
}

.titlebar__btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-color);
}

.titlebar__btn:active {
  background: rgba(255, 255, 255, 0.14);
}

.titlebar__btn--close:hover {
  background: #e81123;
  color: #fff;
}

.titlebar__btn--close:active {
  background: #c50f1f;
}
</style>
