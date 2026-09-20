<script setup lang="ts">
/**
 * 下拉选择（可搜索）。替代 `el-select` + `el-option`。
 *
 * 为什么自己写：需要「搜索 + 键盘上下选 + 可自定义选项内容」，且不引第三方组件库。
 * 字体列表有两百多项，靠肉眼滚动不现实，所以搜索与键盘是必备项。
 *
 * 浮层用 **Teleport + fixed 定位**（不再是组件内的 absolute）：
 * 下拉出现在弹窗、可滚动面板、表格容器里时，父级的 `overflow: hidden`
 * 会把浮层裁掉一半；固定定位 + 按触发器位置计算，则到哪儿都完整可见
 * （与 `ContextMenu.vue` 同一套做法：空间不足时向上翻转）。
 *
 * 交互：点击展开 → 输入即过滤 → ↑↓ 移动 → Enter 选中 → Esc / 点外部关闭。
 * 未选中时显示 placeholder；选项可以带 `hint`（右侧次要说明，如字体来源）。
 * 需要「行内容长这样」的场景（连接下拉）用 `#option` / `#value` 插槽自定义。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { cn } from '@/lib/utils'
import Icon from '@/components/ui/Icon.vue'
import { usePopoverAnchor } from '@/utils/popover'

export interface ComboboxOption {
  label: string
  value: string
  /** 次要说明（右侧小字） */
  hint?: string
}

const props = withDefaults(defineProps<{
  options: ComboboxOption[]
  placeholder?: string
  disabled?: boolean
  /** 搜索框占位文案 */
  searchPlaceholder?: string
  /** 显示「清除」按钮（有值时出现，对应 EP 的 clearable） */
  clearable?: boolean
  /**
   * 允许把搜索框里的内容直接当作值（对应 EP 的 allow-create）。
   * 分页的「每页条数」靠它输入任意数字：列表里给预设，输入框里给自由值。
   */
  allowCreate?: boolean
  /** 是否提供搜索框（对应 EP 的 filterable；关掉后仍支持 ↑↓ + Enter 选择） */
  filterable?: boolean
  /** `sm` 用在工具条 / 分页这种紧凑行里 */
  size?: 'sm' | 'default'
  class?: string
}>(), {
  placeholder: '请选择',
  searchPlaceholder: '搜索…',
  filterable: true,
  size: 'default',
})

const model = defineModel<string>({ default: '' })

const open = ref(false)
const keyword = ref('')
const active = ref(0)
/** 触发器所在容器：点它不算「点外部」 */
const root = ref<HTMLElement | null>(null)
/** 触发按钮：浮层定位以它为准 */
const trigger = ref<HTMLElement | null>(null)
/** 浮层本体：点它也不算「点外部」，另外键盘移动时用它滚动 */
const list = ref<HTMLElement | null>(null)
const search = ref<HTMLInputElement | null>(null)

/*
 * 浮层定位：与 MultiSelect 共用同一套（位置算法、向上翻转、跟随滚动），
 * 免得两个下拉在同样场景下表现不一致。
 */
const { position, update: updatePosition, bind: bindViewportListeners, unbind: unbindViewportListeners }
  = usePopoverAnchor(trigger, list)

const current = computed(() => props.options.find(option => option.value === model.value))

const filtered = computed<ComboboxOption[]>(() => {
  const text = keyword.value.trim().toLowerCase()
  const matched = !text
    ? props.options
    : props.options.filter(option =>
        option.label.toLowerCase().includes(text) || option.value.toLowerCase().includes(text))

  /*
   * allow-create：搜索框里的内容没有精确命中任何选项时，把它作为一项附在末尾。
   * 放在末尾而不是插到最前 —— 预设项才是常用路径，自由输入是例外。
   */
  const raw = keyword.value.trim()
  if (!props.allowCreate || !raw) {
    return matched
  }
  const exact = matched.some(option =>
    option.label.toLowerCase() === text || option.value.toLowerCase() === text)
  return exact ? matched : [...matched, { label: raw, value: raw, hint: '手动输入' }]
})

function close() {
  open.value = false
  unbindViewportListeners()
}

async function show() {
  if (props.disabled) {
    return
  }
  open.value = true
  keyword.value = ''
  active.value = Math.max(0, props.options.findIndex(option => option.value === model.value))
  bindViewportListeners()
  await updatePosition()
  // 有搜索框就聚焦它；没有（filterable=false）就聚焦浮层本身，键盘操作照样可用
  if (props.filterable) {
    search.value?.focus()
  }
  else {
    list.value?.focus()
  }
}

function toggle() {
  if (open.value) {
    close()
  }
  else {
    void show()
  }
}

function pick(option: ComboboxOption) {
  model.value = option.value
  close()
}

/** 清除选择：值置空而不是删除该项（选项来自元数据 / 注册表，不由这里增删） */
function clear() {
  model.value = ''
}

/** 键盘：上下移动会跟着把候选项滚进视野（列表可能很长） */
async function move(step: number) {
  const next = Math.min(Math.max(active.value + step, 0), filtered.value.length - 1)
  active.value = next
  await nextTick()
  list.value?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
}

function onKeydown(event: KeyboardEvent) {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      void move(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      void move(-1)
      break
    case 'Enter': {
      event.preventDefault()
      const hit = filtered.value[active.value]
      if (hit) {
        pick(hit)
      }
      break
    }
    case 'Escape':
      event.preventDefault()
      close()
      break
  }
}

/**
 * 点击外部关闭（capture 阶段处理，避免被内部的 stopPropagation 影响）。
 *
 * 必须同时检查 `root` 与 `list`：浮层已 Teleport 到 body，
 * 它不在 root 里 —— 只看 root 的话，点选项会先被当成「点外部」而关闭。
 */
function onDocumentPointerDown(event: PointerEvent) {
  if (!open.value) {
    return
  }
  const target = event.target as Node
  if (root.value?.contains(target) || list.value?.contains(target)) {
    return
  }
  close()
}

watch(filtered, () => {
  active.value = 0
})

document.addEventListener('pointerdown', onDocumentPointerDown, true)

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  unbindViewportListeners()
})
</script>

<template>
  <div ref="root" :class="cn('relative', props.class)">
    <button
      ref="trigger"
      type="button"
      :disabled="disabled"
      :class="cn(
        'flex w-full items-center gap-2 rounded-md',
        'border border-border bg-surface text-left text-text transition-colors',
        'hover:border-brand/60 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm'
          ? 'h-[calc(26px*var(--app-control-scale))] px-2 text-xs'
          : 'h-[calc(32px*var(--app-control-scale))] px-2.5 text-sm',
        open && 'border-brand/60',
      )"
      :aria-expanded="open"
      @click="toggle"
    >
      <!-- 选中项：默认显示 label；给了 #value 插槽就交给调用方渲染（如连接下拉的标签行） -->
      <span v-if="$slots.value" class="min-w-0 flex-1">
        <slot v-if="current" name="value" :option="current" />
        <span v-else class="block truncate">{{ placeholder }}</span>
      </span>
      <span v-else class="min-w-0 flex-1 truncate">
        {{ current?.label ?? placeholder }}
      </span>

      <button
        v-if="clearable && model"
        type="button"
        class="shrink-0 rounded p-0.5 text-muted transition-colors hover:bg-hover hover:text-text"
        title="清除"
        @click.stop="clear"
      >
        <Icon name="close" class="text-xs" />
      </button>

      <Icon name="chevron-down" class="size-3.5 shrink-0 text-muted" />
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="list"
        tabindex="-1"
        class="fixed z-[9996] overflow-hidden rounded-lg border border-border bg-overlay
          shadow-[var(--shadow-md)] outline-none"
        :style="{
          left: `${position.left}px`,
          top: `${position.top}px`,
          width: `${position.width}px`,
        }"
        @keydown="onKeydown"
      >
        <div v-if="filterable" class="border-b border-border p-1.5">
          <input
            ref="search"
            v-model="keyword"
            :placeholder="searchPlaceholder"
            class="h-[calc(26px*var(--app-control-scale))] w-full rounded-md bg-surface px-2
              text-sm text-text outline-none placeholder:text-muted"
          >
        </div>

        <div class="max-h-64 overflow-y-auto p-1">
          <button
            v-for="(option, index) in filtered"
            :key="option.value"
            type="button"
            :data-active="index === active"
            :class="cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors',
              index === active ? 'bg-active text-text' : 'text-muted hover:bg-hover hover:text-text',
            )"
            @mouseenter="active = index"
            @click="pick(option)"
          >
            <!-- 选项行：默认 label + hint；给了 #option 插槽就整行交给调用方 -->
            <slot v-if="$slots.option" name="option" :option="option" />
            <template v-else>
              <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
              <span v-if="option.hint" class="shrink-0 text-xs text-muted">{{ option.hint }}</span>
            </template>
          </button>

          <p v-if="!filtered.length" class="px-2 py-3 text-center text-xs text-muted">
            没有匹配项
          </p>
        </div>
      </div>
    </Teleport>
  </div>
</template>
