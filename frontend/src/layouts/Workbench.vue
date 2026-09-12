<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTabStore } from '@/stores/tabStore'
import { useDictStore } from '@/stores/dictStore'
import { EventsOn } from '@/api/runtime'
import { toolOf } from '@/utils/tools'
import AppSidebar from '@/components/AppSidebar.vue'
import ToolPickerDialog from '@/components/ToolPickerDialog.vue'
import DbQuery from '@/views/tools/DbQuery.vue'
import ConnectionsView from '@/views/tools/ConnectionsView.vue'
import SqlTemplateView from '@/views/tools/SqlTemplateView.vue'
import DictionaryView from '@/views/tools/DictionaryView.vue'
import SettingsView from '@/views/tools/SettingsView.vue'
import type { ToolType, WorkbenchTab } from '@/types'

const tabStore = useTabStore()
const dictStore = useDictStore()

/** 左侧菜单是否收起 */
const sidebarCollapsed = ref(false)

/** 正在重命名的 Tab ID */
const renamingId = ref<number | null>(null)
/** 重命名输入框的临时值 */
const renameDraft = ref('')
/**
 * 重命名输入框引用。
 * 输入框位于 v-for 内，若用 ref 变量会收集成数组，
 * 这里改用函数式 ref，只记录当前正在编辑的那个元素。
 */
const renameInputRef = ref<HTMLInputElement | null>(null)

function setRenameInputRef(el: Element | ComponentPublicInstance | null) {
  renameInputRef.value = el instanceof HTMLInputElement ? el : null
}
/** 右键菜单锚点坐标 */
const menuPosition = ref({ x: 0, y: 0 })
/** 右键菜单当前作用的 Tab */
const menuTab = ref<WorkbenchTab | null>(null)

/** 拖拽绑定的可变数组：直接操作 store 的 tabs 以保持引用 */
const draggableList = computed({
  get: () => tabStore.tabs,
  set: (value: WorkbenchTab[]) => tabStore.reorder(value),
})

/** Tab 右键菜单项 */
interface TabMenuItem {
  key: string
  label: string
  disabled?: boolean
}

/** 右键菜单项；单例标签不提供重命名 */
const menuItems = computed<TabMenuItem[]>(() => {
  const tab = menuTab.value
  if (!tab) {
    return []
  }
  return [
    { key: 'lock', label: tab.isLocked ? '解锁标签' : '锁定标签' },
    ...(canRename(tab) ? [{ key: 'rename', label: '重命名' }] : []),
    { key: 'close', label: '关闭', disabled: tab.isLocked },
    { key: 'closeOthers', label: '关闭其他' },
    { key: 'closeAll', label: '关闭全部' },
  ]
})

/** 判断 Tab 是否可关闭：锁定状态隐藏关闭按钮 */
function canClose(tab: WorkbenchTab): boolean {
  return !tab.isLocked
}

/**
 * 判断 Tab 是否可重命名。
 *
 * 单例标签的名称就是功能名（全局只有一个），改名会让入口失去可辨识性，
 * 因此只允许多例工具标签与未绑定功能的空白标签改名。
 */
function canRename(tab: WorkbenchTab): boolean {
  const definition = toolOf(tab.toolType)
  return definition ? definition.multi : true
}

/** 事件监听的取消函数 */
let offQuit: (() => void) | null = null

// ------------------------------------------------------------ 初始加载

onMounted(async () => {
  await Promise.all([
    tabStore.load(),
    dictStore.loadAll(),
  ])

  // 退出前兜底保存：Wails 关闭窗口时通知
  offQuit = EventsOn('app:before-quit', () => {
    void tabStore.saveNow()
  })
})

onBeforeUnmount(() => {
  offQuit?.()
})

// ------------------------------------------------------------ 激活与新建

function handleTabClick(tab: WorkbenchTab) {
  tabStore.setActive(tab.id)
}

/** 工具选择弹窗是否可见（标签栏 + 触发） */
const pickerVisible = ref(false)

/**
 * 选中工具：
 *  - 多例工具新建实例标签，名称自动带上序号（如「SQL 查询 2」）；
 *  - 单例工具跳转到已有标签（不存在则新建）。
 */
function handleToolPicked(type: ToolType) {
  const definition = toolOf(type)
  tabStore.openTool(type, { newInstance: definition?.multi ?? false })
}

// ------------------------------------------------------------ 标签栏滚动

/** 标签滚动容器 */
const tabsScroller = ref<HTMLDivElement | null>(null)
/** 是否还能向左 / 向右滚动（决定两端箭头的显隐） */
const canScrollLeft = ref(false)
const canScrollRight = ref(false)

/** 根据滚动位置更新箭头显隐 */
function updateTabsScrollState() {
  const el = tabsScroller.value
  if (!el) {
    canScrollLeft.value = false
    canScrollRight.value = false
    return
  }
  canScrollLeft.value = el.scrollLeft > 1
  canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

/**
 * 标签栏上的滚轮：纵向滚动量转为横向滚动。
 * shift + 滚浏览器已自带横向语义，交给默认行为。
 */
function handleTabsWheel(event: WheelEvent) {
  if (event.deltaY === 0 || event.shiftKey) {
    return
  }
  event.preventDefault()
  tabsScroller.value?.scrollBy({ left: event.deltaY })
}

/** 点击箭头滚动，步长约为可视宽度的 60% */
function scrollTabs(direction: 1 | -1) {
  const el = tabsScroller.value
  if (!el) {
    return
  }
  el.scrollBy({ left: direction * Math.round(el.clientWidth * 0.6), behavior: 'smooth' })
}

/** 标签数量变化（新建/关闭/拖拽排序）后重新判定是否溢出 */
watch(
  () => tabStore.tabs.map(tab => tab.uid).join(','),
  async () => {
    await nextTick()
    updateTabsScrollState()
  },
)

/** 激活标签变化后把它滚入可视区，否则切到被遮住的标签会没有反馈 */
watch(
  () => tabStore.activeId,
  async () => {
    await nextTick()
    updateTabsScrollState()
    tabsScroller.value
      ?.querySelector('.workbench__tab--active')
      ?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  },
)

/** 容器尺寸变化（窗口缩放、菜单收起）也会改变是否溢出 */
let tabsResizeObserver: ResizeObserver | null = null

onMounted(() => {
  tabsResizeObserver = new ResizeObserver(() => updateTabsScrollState())
  if (tabsScroller.value) {
    tabsResizeObserver.observe(tabsScroller.value)
  }
  updateTabsScrollState()
})

onBeforeUnmount(() => {
  tabsResizeObserver?.disconnect()
  tabsResizeObserver = null
})

// ------------------------------------------------------------ 重命名

function startRename(tab: WorkbenchTab) {
  // 单例标签不允许改名：双击与右键菜单都拦在这里
  if (!canRename(tab)) {
    return
  }
  renamingId.value = tab.id
  renameDraft.value = tab.name
  void nextTick(() => {
    renameInputRef.value?.focus()
    renameInputRef.value?.select()
  })
}

function commitRename() {
  if (renamingId.value === null) {
    return
  }
  tabStore.renameTab(renamingId.value, renameDraft.value)
  renamingId.value = null
}

function cancelRename() {
  renamingId.value = null
}

// ------------------------------------------------------------ 右键菜单

function openContextMenu(event: MouseEvent, tab: WorkbenchTab) {
  event.preventDefault()
  menuTab.value = tab
  menuPosition.value = { x: event.clientX, y: event.clientY }
}

function handleMenuSelect(key: string) {
  const tab = menuTab.value
  if (!tab) {
    return
  }

  switch (key) {
    case 'lock':
      tabStore.toggleLock(tab.id)
      break
    case 'rename':
      startRename(tab)
      break
    case 'close':
      handleClose(tab)
      break
    case 'closeOthers':
      tabStore.closeOthers(tab.id)
      break
    case 'closeAll':
      handleCloseAll()
      break
    default:
      break
  }
  menuTab.value = null
}

// ------------------------------------------------------------ 关闭

function handleClose(tab: WorkbenchTab) {
  if (tab.isLocked) {
    ElMessage.warning('标签已锁定，请先解锁')
    return
  }
  tabStore.closeTab(tab.id)
}

async function handleCloseAll() {
  if (tabStore.closableTabs.length === 0) {
    return
  }
  try {
    await ElMessageBox.confirm(
      '确定要关闭全部未锁定的标签吗？',
      '关闭全部',
      { type: 'warning', confirmButtonText: '关闭', cancelButtonText: '取消' },
    )
    tabStore.closeAll()
  }
  catch {
    // 用户取消，无需处理
  }
}

// ------------------------------------------------------------ 内容区

/** 保存工具状态（显式传 tabId，避免异步回调写错标签） */
function handlePayloadChange(tabId: number, payload: unknown) {
  tabStore.updatePayload(tabId, payload)
}

/** 空 payload 常量：模板中必须复用同一引用，否则每次渲染都会产生新对象 */
const EMPTY_PAYLOAD: Record<string, unknown> = {}

/**
 * 各标签的 payload 快照，只在该标签被激活时刷新一次。
 *
 * 为何不用 computed、也不在模板里 JSON.parse：
 * 二者都会在每次渲染时产生新对象，导致子组件 props 持续变化，
 * 甚至形成渲染循环（工具回传状态会写回 tab.payload，
 * 形成「写 → 重算 → 新对象 → 重渲染」的环，表现为界面持续闪烁）。
 */
const payloadCache = shallowRef<Record<string, Record<string, unknown>>>({})

/** 取某标签的 payload 快照；引用稳定，只有该标签被激活时才更新 */
function payloadOf(uid: string): Record<string, unknown> {
  return payloadCache.value[uid] ?? EMPTY_PAYLOAD
}

/**
 * 已打开过（挂载过）的标签 uid。
 *
 * 内容区用 v-show 常驻挂载，而不是按激活标签动态重建：
 * 后者会在切换标签时卸载组件，导致查询结果、表单填写等内容全部丢失
 * （切回来就变回初始状态）。标签关闭时同步移除以避免实例与 DOM 泄漏。
 *
 * 注意用 uid 而不是 id：新建标签的 id 是负数占位，首次落盘后会被
 * 后端重新分配，用 id 做身份会在保存回来时销毁重建（闪一下）。
 */
const mountedTabUids = ref<string[]>([])

/** 需要渲染内容的标签，保持标签栏顺序使 DOM 顺序稳定 */
const mountedTabs = computed(() =>
  tabStore.tabs.filter(tab => mountedTabUids.value.includes(tab.uid)),
)

/** 激活标签：记录 payload 快照（供挂载时恢复状态）并标记为需要挂载 */
watch(
  () => tabStore.activeId,
  (id) => {
    if (id === null) {
      return
    }
    const tab = tabStore.tabs.find(item => item.id === id)
    if (!tab) {
      return
    }

    let parsed: Record<string, unknown> = EMPTY_PAYLOAD
    try {
      const value = JSON.parse(tab.payload || '{}')
      if (value && typeof value === 'object') {
        parsed = value as Record<string, unknown>
      }
    }
    catch {
      parsed = EMPTY_PAYLOAD
    }
    payloadCache.value = { ...payloadCache.value, [tab.uid]: parsed }

    if (!mountedTabUids.value.includes(tab.uid)) {
      mountedTabUids.value = [...mountedTabUids.value, tab.uid]
    }
  },
  { immediate: true },
)

/** 标签被关闭时清理挂载标记与 payload 快照 */
watch(
  () => tabStore.tabs.map(tab => tab.uid).join(','),
  () => {
    const alive = new Set(tabStore.tabs.map(tab => tab.uid))
    mountedTabUids.value = mountedTabUids.value.filter(uid => alive.has(uid))
    readyTabUids.value = readyTabUids.value.filter(uid => alive.has(uid))

    const nextCache: Record<string, Record<string, unknown>> = {}
    for (const uid of Object.keys(payloadCache.value)) {
      if (alive.has(uid)) {
        nextCache[uid] = payloadCache.value[uid]
      }
    }
    payloadCache.value = nextCache
  },
)

/**
 * 已完成首次初始化的标签 uid。
 *
 * 各视图挂载后会自己去查本地库（模板/连接/词典/系统字体…），
 * 完成时 emit('ready')；在此之前用遮罩盖住内容区，
 * 避免「先渲染空界面 → 数据到达 → 界面跳一下」的闪动。
 */
const readyTabUids = ref<string[]>([])

/** 激活标签是否已就绪；未绑定功能的空白标签没有初始化过程，直接视为就绪 */
const activeReady = computed(() => {
  const tab = tabStore.activeTab
  if (!tab || !toolOf(tab.toolType)) {
    return true
  }
  return readyTabUids.value.includes(tab.uid)
})

/** 视图上报初始化完成 */
function handleTabReady(uid: string) {
  if (!readyTabUids.value.includes(uid)) {
    readyTabUids.value = [...readyTabUids.value, uid]
  }
}
</script>

<template>
  <section class="workbench">
    <!-- 左：菜单 -->
    <AppSidebar :collapsed="sidebarCollapsed" />

    <!-- 右：标签栏 + 内容 -->
    <div class="workbench__main">
      <div class="workbench__bar">
        <!-- 菜单缩进按钮 -->
        <button
          class="workbench__icon-btn"
          type="button"
          :title="sidebarCollapsed ? '展开菜单' : '收起菜单'"
          @click="sidebarCollapsed = !sidebarCollapsed"
        >
          <el-icon><Expand v-if="sidebarCollapsed" /><Fold v-else /></el-icon>
        </button>

        <!-- 新建：打开工具选择弹窗 -->
        <button
          class="workbench__icon-btn"
          type="button"
          title="新建标签（选择工具）"
          @click="pickerVisible = true"
        >
          <el-icon><Plus /></el-icon>
        </button>

        <span class="workbench__divider" aria-hidden="true" />

        <!-- 标签列表：横向滚动 + 拖拽排序；溢出时两端显示滚动箭头 -->
        <div class="workbench__tabs-wrap">
          <div
            ref="tabsScroller"
            class="workbench__tabs"
            @wheel="handleTabsWheel"
            @scroll.passive="updateTabsScrollState"
          >
            <VueDraggable
              v-model="draggableList"
              class="workbench__tabs-list"
              :animation="150"
              ghost-class="workbench__tab--ghost"
              handle=".workbench__tab"
            >
          <div
            v-for="tab in tabStore.tabs"
            :key="tab.uid"
            class="workbench__tab"
            :class="{
              'workbench__tab--active': tab.id === tabStore.activeId,
              'workbench__tab--locked': tab.isLocked,
            }"
            @click="handleTabClick(tab)"
            @dblclick.stop="startRename(tab)"
            @contextmenu="openContextMenu($event, tab)"
          >
            <el-icon v-if="toolOf(tab.toolType)" class="workbench__tab-icon">
              <component :is="toolOf(tab.toolType)?.icon" />
            </el-icon>
            <el-icon v-if="tab.isLocked" class="workbench__tab-icon"><Lock /></el-icon>

            <input
              v-if="renamingId === tab.id"
              :ref="setRenameInputRef"
              v-model="renameDraft"
              class="workbench__tab-input"
              @click.stop
              @dblclick.stop
              @keydown.enter.prevent="commitRename"
              @keydown.esc.prevent="cancelRename"
              @blur="commitRename"
            >
            <span v-else class="workbench__tab-name">{{ tab.name }}</span>

            <el-icon
              v-if="canClose(tab)"
              class="workbench__tab-close"
              @click.stop="handleClose(tab)"
            >
              <Close />
            </el-icon>
          </div>
            </VueDraggable>
          </div>

          <!-- 溢出时的滚动箭头：绝对定位悬浮在标签两端，不占布局 -->
          <button
            v-if="canScrollLeft"
            class="workbench__scroll-btn is-left"
            type="button"
            title="向左滚动"
            @click="scrollTabs(-1)"
          >
            <el-icon><ArrowLeft /></el-icon>
          </button>
          <button
            v-if="canScrollRight"
            class="workbench__scroll-btn is-right"
            type="button"
            title="向右滚动"
            @click="scrollTabs(1)"
          >
            <el-icon><ArrowRight /></el-icon>
          </button>
        </div>
      </div>

      <!--
        内容区：已打开过的标签全部常驻挂载，用 v-show 切换显隐。
        用 v-if 按激活标签渲染会卸载组件，切换标签后查询结果、表单内容都会丢失。
      -->
      <div class="workbench__body">
        <template v-if="mountedTabs.length">
          <template v-for="tab in mountedTabs" :key="tab.uid">
            <!-- 历史遗留的空白标签 -->
            <el-empty
              v-if="!toolOf(tab.toolType)"
              v-show="tab.id === tabStore.activeId"
              description="该标签没有绑定功能，可从左侧菜单打开需要的功能"
            />

            <DbQuery
              v-else-if="tab.toolType === 'db-query'"
              v-show="tab.id === tabStore.activeId"
              :tab-id="tab.id"
              :initial-payload="payloadOf(tab.uid)"
              @change="handlePayloadChange"
              @ready="handleTabReady(tab.uid)"
            />

            <ConnectionsView
              v-else-if="tab.toolType === 'connections'"
              v-show="tab.id === tabStore.activeId"
              @ready="handleTabReady(tab.uid)"
            />
            <SqlTemplateView
              v-else-if="tab.toolType === 'sql-template'"
              v-show="tab.id === tabStore.activeId"
              @ready="handleTabReady(tab.uid)"
            />
            <DictionaryView
              v-else-if="tab.toolType === 'dictionary'"
              v-show="tab.id === tabStore.activeId"
              @ready="handleTabReady(tab.uid)"
            />
            <SettingsView
              v-else-if="tab.toolType === 'settings'"
              v-show="tab.id === tabStore.activeId"
              @ready="handleTabReady(tab.uid)"
            />
          </template>
        </template>

        <el-empty v-else description="暂无标签，可从左侧菜单打开功能" />

        <!-- 首次初始化遮罩：盖住「空界面 → 数据到达」的过程，避免闪动 -->
        <Transition name="workbench-loading">
          <div v-if="!activeReady" class="workbench__loading">
            <span class="workbench__loading-spinner" aria-hidden="true" />
            <span class="workbench__loading-text">正在加载…</span>
          </div>
        </Transition>
      </div>
    </div>

    <!-- 工具选择：标签栏 + 打开，选中后新建/跳转标签 -->
    <ToolPickerDialog v-model:visible="pickerVisible" @select="handleToolPicked" />

    <!-- Tab 右键菜单：用 Teleport 挂到 body，避免被容器裁剪 -->
    <Teleport to="body">
      <div
        v-if="menuTab"
        class="workbench__menu-mask"
        @mousedown="menuTab = null"
        @contextmenu.prevent="menuTab = null"
      />
      <ul
        v-if="menuTab"
        class="workbench__menu"
        :style="{ left: `${menuPosition.x}px`, top: `${menuPosition.y}px` }"
      >
        <li
          v-for="item in menuItems"
          :key="item.key"
          class="workbench__menu-item"
          :class="{ 'is-disabled': item.disabled }"
          @click="handleMenuSelect(item.key)"
        >
          {{ item.label }}
        </li>
      </ul>
    </Teleport>
  </section>
</template>

<style scoped>
.workbench {
  display: flex;
  flex-direction: row;
  height: 100%;
  overflow: hidden;
}

.workbench__main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

/* ------------------------------------------------------------ 标签栏 */

.workbench__bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border-color);
}

.workbench__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: calc(28px * var(--app-control-scale));
  height: calc(28px * var(--app-control-scale));
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--app-font-size-xl);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.workbench__icon-btn:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.workbench__divider {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--border-color);
}

/* 滚动容器外层：同时是滚动箭头的定位父级 */
.workbench__tabs-wrap {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
}

/* 标签滚动容器：溢出时横向滚动；滚动条隐藏，靠滚轮 / 箭头 / 自动滚入触达 */
.workbench__tabs {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.workbench__tabs::-webkit-scrollbar {
  display: none;
}

.workbench__tabs-list {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 溢出时的两端箭头：悬浮在标签之上并带同色渐隐，不占布局宽度 */
.workbench__scroll-btn {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  width: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
}

.workbench__scroll-btn:hover {
  color: var(--text-color);
}

.workbench__scroll-btn.is-left {
  left: 0;
  background: linear-gradient(90deg, var(--panel-bg), transparent);
}

.workbench__scroll-btn.is-right {
  right: 0;
  background: linear-gradient(270deg, var(--panel-bg), transparent);
}

.workbench__tab {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  height: calc(34px * var(--app-control-scale));
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--text-muted);
  font-size: var(--app-font-size);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
  user-select: none;
}

.workbench__tab:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.workbench__tab--active {
  background: var(--active-bg);
  border-color: var(--brand-color);
  color: var(--text-color);
}

.workbench__tab--ghost {
  opacity: 0.4;
}

.workbench__tab-icon {
  font-size: var(--app-font-size-sm);
  color: var(--text-muted);
}

.workbench__tab-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workbench__tab-input {
  width: 120px;
  height: calc(22px * var(--app-control-scale));
  padding: 0 4px;
  border: 1px solid var(--brand-color);
  border-radius: 4px;
  background: var(--bg-color);
  color: var(--text-color);
  font-size: var(--app-font-size);
  outline: none;
}

.workbench__tab-close {
  font-size: var(--app-font-size-sm);
  border-radius: 50%;
  padding: 2px;
}

.workbench__tab-close:hover {
  background: rgba(248, 113, 113, 0.25);
  color: var(--danger-color);
}

/* ------------------------------------------------------------ 内容区 */

.workbench__body {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/*
 * 首次初始化遮罩。
 *
 * 遮罩底色立即生效（不做淡入）：初始化期间绝不能露出「半成品界面」
 * （下拉框还空着、条件表单还没长出来），否则仍会看到界面跳一下。
 * 底色与应用背景同源，因此几百毫秒的遮盖在观感上就是一次正常的加载。
 *
 * 但转圈与文案延迟 0.25s 才淡入：本地库查询常几十毫秒就结束，
 * 遮罩自己不该闪一下。
 */
.workbench__loading {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-muted);
  font-size: var(--app-font-size-sm);
  /* 与应用背景透明度联动，避免透明窗口下遮罩变成一块死色 */
  background: rgb(var(--bg-rgb) / calc(var(--app-bg-alpha) * 0.96));
}

.workbench__loading-spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--border-color);
  border-top-color: var(--brand-color);
  border-radius: 50%;
  animation:
    workbench-loading-in 0.2s ease 0.25s both,
    workbench-spin 0.8s linear infinite;
}

.workbench__loading-text {
  animation: workbench-loading-in 0.2s ease 0.25s both;
}

/*
 * 就绪后淡出 200ms 再移除。
 * 此时内容已渲染完毕，让遮罩「化掉」而不是硬切；
 * 淡出期间不再拦截点击，避免多挡 200ms 的操作。
 * 只定义 leave，不定义 enter：遮罩出现必须瞬间覆盖，否则又会露出半成品界面。
 */
.workbench-loading-leave-active {
  transition: opacity 0.2s ease;
  pointer-events: none;
}

.workbench-loading-leave-to {
  opacity: 0;
}

@keyframes workbench-loading-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@keyframes workbench-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ------------------------------------------------------------ 右键菜单 */

.workbench__menu-mask {
  position: fixed;
  inset: 0;
  z-index: 2000;
}

.workbench__menu {
  position: fixed;
  z-index: 2001;
  min-width: 160px;
  margin: 0;
  padding: 6px;
  list-style: none;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--menu-bg);
  backdrop-filter: blur(16px);
  box-shadow: var(--shadow-md);
  user-select: none;
}

.workbench__menu-item {
  padding: 7px 10px;
  border-radius: 6px;
  color: var(--text-color);
  font-size: var(--app-font-size);
  cursor: pointer;
}

.workbench__menu-item:hover:not(.is-disabled) {
  background: var(--active-bg);
}

.workbench__menu-item.is-disabled {
  color: var(--text-muted);
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
