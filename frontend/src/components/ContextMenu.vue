<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ContextMenuAction } from '@/types'

const props = withDefaults(defineProps<{
  /** 是否显示 */
  visible: boolean
  /** 触发位置（clientX / clientY） */
  x?: number
  /** 触发位置（clientX / clientY） */
  y?: number
  /** 菜单项 */
  items?: ContextMenuAction[]
}>(), {
  x: 0,
  y: 0,
  items: () => [],
})

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'select', item: ContextMenuAction): void
}>()

const menuRef = ref<HTMLElement | null>(null)
/** 修正后的定位，避免菜单溢出视口 */
const position = ref({ left: 0, top: 0 })
/** 当前高亮的菜单项索引，支持键盘操作 */
const activeIndex = ref(-1)

/** 可视菜单项（过滤空配置） */
const menuItems = computed(() => props.items.filter(item => item && item.key))

/** 关闭菜单 */
function close() {
  emit('update:visible', false)
}

/**
 * 根据触发点计算菜单位置：
 * 若右侧/下方空间不足，则向内翻转，保证菜单完整可见。
 */
async function updatePosition() {
  await nextTick()
  const menu = menuRef.value
  if (!menu) {
    return
  }

  const gap = 8
  const rect = menu.getBoundingClientRect()
  let left = props.x
  let top = props.y

  if (left + rect.width + gap > window.innerWidth) {
    left = Math.max(gap, props.x - rect.width)
  }
  if (top + rect.height + gap > window.innerHeight) {
    top = Math.max(gap, props.y - rect.height)
  }

  position.value = { left, top }
}

/** 是否命中菜单内部 */
function isInsideMenu(target: EventTarget | null): boolean {
  return target instanceof Node && !!menuRef.value?.contains(target)
}

/** 选择某一项 */
function selectItem(item: ContextMenuAction) {
  if (item.disabled) {
    return
  }
  emit('select', item)
  close()
}

/** 全局按下鼠标：点击菜单外部即关闭 */
function handleGlobalPointerDown(event: MouseEvent) {
  if (!props.visible) {
    return
  }
  if (!isInsideMenu(event.target)) {
    close()
  }
}

/** 键盘导航：上下移动、回车执行、Esc 关闭 */
function handleKeydown(event: KeyboardEvent) {
  if (!props.visible) {
    return
  }

  const items = menuItems.value
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    let next = activeIndex.value
    for (let i = 0; i < items.length; i++) {
      next = (next + step + items.length) % items.length
      if (!items[next].disabled) {
        break
      }
    }
    activeIndex.value = next
    return
  }
  if (event.key === 'Enter' && activeIndex.value >= 0) {
    event.preventDefault()
    selectItem(items[activeIndex.value])
  }
}

/** 右键菜单由业务统一接管，阻止浏览器默认菜单 */
function handleGlobalContextMenu(event: MouseEvent) {
  if (!props.visible) {
    return
  }
  event.preventDefault()
}

watch(() => props.visible, (value) => {
  if (value) {
    activeIndex.value = -1
    void updatePosition()
  }
})

watch(() => [props.x, props.y], () => {
  if (props.visible) {
    void updatePosition()
  }
})

onMounted(() => {
  window.addEventListener('pointerdown', handleGlobalPointerDown, true)
  window.addEventListener('contextmenu', handleGlobalContextMenu)
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handleGlobalPointerDown, true)
  window.removeEventListener('contextmenu', handleGlobalContextMenu)
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="context-menu">
      <div
        v-if="visible"
        ref="menuRef"
        class="context-menu"
        role="menu"
        :style="{ left: `${position.left}px`, top: `${position.top}px` }"
        @contextmenu.prevent
      >
        <template v-for="(item, index) in menuItems" :key="item.key">
          <button
            class="context-menu__item"
            :class="{
              'is-disabled': item.disabled,
              'is-danger': item.danger,
              'is-active': index === activeIndex,
            }"
            type="button"
            role="menuitem"
            :disabled="item.disabled"
            @mouseenter="activeIndex = index"
            @click="selectItem(item)"
          >
            <span class="context-menu__label">{{ item.label }}</span>
            <span v-if="item.shortcut" class="context-menu__shortcut">{{ item.shortcut }}</span>
          </button>
          <div v-if="item.divided" class="context-menu__divider" />
        </template>

        <p v-if="!menuItems.length" class="context-menu__empty">暂无可用操作</p>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 180px;
  padding: 6px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--menu-bg);
  backdrop-filter: blur(16px);
  box-shadow: 0 20px 45px rgba(2, 6, 23, 0.55);
  user-select: none;
  -webkit-user-select: none;
}

.context-menu__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-color);
  font-size: var(--app-font-size);
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.context-menu__item.is-active:not(.is-disabled),
.context-menu__item:hover:not(.is-disabled) {
  background: var(--active-bg);
}

.context-menu__item.is-disabled {
  color: var(--text-muted);
  opacity: 0.5;
  cursor: not-allowed;
}

.context-menu__item.is-danger {
  color: var(--danger-color);
}

.context-menu__item.is-danger.is-active:not(.is-disabled),
.context-menu__item.is-danger:hover:not(.is-disabled) {
  background: rgba(248, 113, 113, 0.16);
}

.context-menu__shortcut {
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
  font-family: var(--font-mono);
}

.context-menu__divider {
  height: 1px;
  margin: 5px 6px;
  background: var(--border-color);
}

.context-menu__empty {
  margin: 0;
  padding: 8px 10px;
  color: var(--text-muted);
  font-size: var(--app-font-size-sm);
}

.context-menu-enter-active,
.context-menu-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.context-menu-enter-from,
.context-menu-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>
