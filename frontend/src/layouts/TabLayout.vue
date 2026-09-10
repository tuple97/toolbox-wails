<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTabStore } from '@/stores/tabStore'
import { useDictStore } from '@/stores/dictStore'
import { EventsOn } from '@/api/runtime'
import ToolSelector from '@/views/ToolSelector.vue'
import DbQuery from '@/views/tools/DbQuery.vue'
import type { ToolType, WorkbenchTab } from '@/types'

const tabStore = useTabStore()
const dictStore = useDictStore()

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

/** 右键菜单项 */
const menuItems = computed(() => {
  const tab = menuTab.value
  if (!tab) {
    return []
  }
  return [
    { key: 'lock', label: tab.isLocked ? '解锁标签' : '锁定标签' },
    { key: 'rename', label: '重命名' },
    { key: 'close', label: '关闭', disabled: tab.isLocked },
    { key: 'closeOthers', label: '关闭其他' },
    { key: 'closeAll', label: '关闭全部' },
  ]
})

/** 判断 Tab 是否可关闭：锁定状态隐藏关闭按钮 */
function canClose(tab: WorkbenchTab): boolean {
  return !tab.isLocked
}

/** 事件监听的取消函数 */
let offQuit: (() => void) | null = null

// ------------------------------------------------------------ 初始加载

onMounted(async () => {
  await Promise.all([
    tabStore.load(),
    dictStore.loadAll(),
  ])

  // 首次进入若无任何 Tab，自动创建一个，避免空白界面
  if (tabStore.tabs.length === 0) {
    tabStore.addTab('placeholder', '新建标签 1')
  }

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

function handleAddTab() {
  tabStore.addTab('placeholder')
}

// ------------------------------------------------------------ 重命名

function startRename(tab: WorkbenchTab) {
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

async function handleClose(tab: WorkbenchTab) {
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

// ------------------------------------------------------------ 工具绑定

function handleBindTool(toolType: ToolType) {
  const tab = tabStore.activeTab
  if (!tab) {
    return
  }
  tabStore.bindTool(tab.id, toolType)
}

/** 当前激活 Tab 的 payload 解析结果，供工具组件使用 */

/**
 * 保存工具状态。
 * 显式接收 tabId 而非读取 activeTab，避免工具内部异步回调
 * 在用户已切换标签后把数据写到错误的标签上。
 */
function handlePayloadChange(tabId: number, payload: unknown) {
  tabStore.updatePayload(tabId, payload)
}

/**
 * 当前激活 Tab 的初始 payload，仅在「切换标签」时解析一次。
 *
 * 为何不用 computed：
 * computed 依赖 tab.payload，而工具组件回传状态时又会写入 tab.payload，
 * 于是「写入 → computed 重算 → 新对象 → 子组件 props 变化 → 子组件重渲染」
 * 形成渲染循环（表现为界面持续闪烁）。
 *
 * 这里改用 watch 只在 activeId / toolType 变化时更新，
 * 工具运行期间 activePayload 引用保持稳定，从根本上断开该环。
 */
const activePayload = shallowRef<Record<string, unknown>>({})

watch(
  () => {
    const tab = tabStore.activeTab
    // 只关心「哪个标签 + 哪种工具」，payload 内容变化不触发重算
    return tab ? `${tab.id}:${tab.toolType}` : ''
  },
  () => {
    const tab = tabStore.activeTab
    if (!tab) {
      activePayload.value = {}
      return
    }
    try {
      const parsed = JSON.parse(tab.payload || '{}')
      activePayload.value = parsed && typeof parsed === 'object' ? parsed : {}
    }
    catch {
      activePayload.value = {}
    }
  },
  { immediate: true },
)
</script>

<template>
  <section class="workbench">
    <!-- Tabs 栏：拖拽排序 + + 按钮 -->
    <div class="workbench__bar">
      <VueDraggable
        v-model="draggableList"
        class="workbench__tabs"
        :animation="150"
        ghost-class="workbench__tab--ghost"
        handle=".workbench__tab"
      >
        <div
          v-for="tab in tabStore.tabs"
          :key="tab.id"
          class="workbench__tab"
          :class="{
            'workbench__tab--active': tab.id === tabStore.activeId,
            'workbench__tab--locked': tab.isLocked,
          }"
          @click="handleTabClick(tab)"
          @dblclick.stop="startRename(tab)"
          @contextmenu="openContextMenu($event, tab)"
        >
          <el-icon v-if="tab.isLocked" class="workbench__tab-icon">
            <Lock />
          </el-icon>

          <!-- 双击进入编辑态 -->
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

          <!-- 未锁定时展示关闭按钮 -->
          <el-icon
            v-if="canClose(tab)"
            class="workbench__tab-close"
            @click.stop="handleClose(tab)"
          >
            <Close />
          </el-icon>
        </div>
      </VueDraggable>

      <button
        class="workbench__add"
        type="button"
        title="新建标签"
        @click="handleAddTab"
      >
        <el-icon><Plus /></el-icon>
      </button>
    </div>

    <!-- 内容区：按 tool_type 渲染对应工具 -->
    <div class="workbench__body">
      <template v-if="tabStore.activeTab">
        <ToolSelector
          v-if="tabStore.activeTab.toolType === 'placeholder'"
          @select="handleBindTool"
        />

        <DbQuery
          v-else-if="tabStore.activeTab.toolType === 'db-query'"
          :key="tabStore.activeTab.id"
          :tab-id="tabStore.activeTab.id"
          :initial-payload="activePayload"
          @change="handlePayloadChange"
        />
      </template>

      <el-empty v-else description="暂无标签，点击左侧 + 新建" />
    </div>

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
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.workbench__bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border-color);
}

.workbench__tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.workbench__tabs::-webkit-scrollbar {
  display: none;
}

.workbench__tab {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  height: 34px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 13px;
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

.workbench__tab--locked {
  cursor: pointer;
}

.workbench__tab--ghost {
  opacity: 0.4;
}

.workbench__tab-icon {
  font-size: 12px;
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
  height: 22px;
  padding: 0 4px;
  border: 1px solid var(--brand-color);
  border-radius: 4px;
  background: var(--bg-color);
  color: var(--text-color);
  font-size: 13px;
  outline: none;
}

.workbench__tab-close {
  font-size: 12px;
  border-radius: 50%;
  padding: 2px;
}

.workbench__tab-close:hover {
  background: rgba(248, 113, 113, 0.25);
  color: var(--danger-color);
}

.workbench__add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.workbench__add:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.workbench__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* 右键菜单遮罩：点击任意处关闭 */
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
  font-size: 13px;
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
