<script setup lang="ts">
import { computed, ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useTabStore } from '@/stores/tabStore'
import { useConfigStore } from '@/stores/configStore'
import { PINNED_TOP_TOOLS, TOOL_GROUPS, TOP_LEVEL_TOOLS, toolOf } from '@/utils/tools'
import type { ToolType } from '@/types'

defineProps<{
  /** 是否收起（收起后由标签栏的按钮展开） */
  collapsed: boolean
}>()

const tabStore = useTabStore()
const configStore = useConfigStore()

// ------------------------------------------------------------ 菜单配置（排序 / 显示）

/**
 * 菜单配置，持久化在 settings.sidebar_config（JSON）。
 * 只存「组内顺序」与「隐藏列表」；工具属于哪个分组由 utils/tools.ts 决定，不可改。
 */
interface SidebarConfig {
  /** 分组 label → 组内工具顺序 */
  order: Record<string, ToolType[]>
  /** 被隐藏的工具 */
  hidden: ToolType[]
}

/** 解析并校正持久化配置：未知工具/分组剔除，缺失的按默认顺序补齐 */
function parseSidebarConfig(raw: string | undefined): SidebarConfig {
  const config: SidebarConfig = { order: {}, hidden: [] }
  try {
    const parsed = JSON.parse(raw || '{}') as Partial<SidebarConfig>
    const hidden = Array.isArray(parsed.hidden) ? parsed.hidden : []
    config.hidden = hidden.filter(type => toolOf(type))

    for (const group of TOOL_GROUPS) {
      const saved = parsed.order?.[group.label]
      config.order[group.label] = Array.isArray(saved)
        ? [
            ...saved.filter(type => group.tools.includes(type)),
            ...group.tools.filter(type => !saved.includes(type)),
          ]
        : [...group.tools]
    }
  }
  catch {
    // 配置损坏时回退默认结构
  }
  return config
}

function serializeSidebarConfig(config: SidebarConfig): string {
  return JSON.stringify({ order: config.order, hidden: config.hidden })
}

/** 持久化的菜单配置 */
const sidebarConfig = computed(() => parseSidebarConfig(configStore.values.sidebar_config))

/** 普通态分组实际显示的工具：按配置顺序、剔除隐藏项 */
function visibleGroupTools(group: { label: string, tools: ToolType[] }): ToolType[] {
  const order = sidebarConfig.value.order[group.label] ?? [...group.tools]
  return order.filter(type => !sidebarConfig.value.hidden.includes(type))
}

/** 组内菜单全部隐藏时整组不显示 */
function isGroupVisible(group: { label: string, tools: ToolType[] }): boolean {
  return visibleGroupTools(group).length > 0
}

/**
 * 顶级工具按「置顶 / 贴底」分成两段渲染：
 * 首页在分组菜单之上（一眼可见），设置之类的留在分组菜单之下（贴底）。
 * 编辑态要展示全部（含已隐藏，带眼睛图标），所以可见性单独再过滤一层。
 */
const pinnedTopTools = computed(() =>
  TOP_LEVEL_TOOLS.filter(type => PINNED_TOP_TOOLS.includes(type)),
)
const bottomTopTools = computed(() =>
  TOP_LEVEL_TOOLS.filter(type => !PINNED_TOP_TOOLS.includes(type)),
)
const visiblePinnedTopTools = computed(() =>
  pinnedTopTools.value.filter(type => !sidebarConfig.value.hidden.includes(type)),
)
const visibleBottomTopTools = computed(() =>
  bottomTopTools.value.filter(type => !sidebarConfig.value.hidden.includes(type)),
)

// ------------------------------------------------------------ 编辑态

const editing = ref(false)
/** 编辑草稿：点「完成」才落盘，避免拖一半就把半成品配置持久化 */
const draftOrder = ref<Record<string, ToolType[]>>({})
const draftHidden = ref<ToolType[]>([])

function enterEdit() {
  const config = parseSidebarConfig(configStore.values.sidebar_config)
  const order: Record<string, ToolType[]> = {}
  for (const group of TOOL_GROUPS) {
    order[group.label] = config.order[group.label] ?? [...group.tools]
  }
  draftOrder.value = order
  draftHidden.value = [...config.hidden]
  editing.value = true
}

/** 草稿恢复为默认：默认顺序 + 全部显示 */
function resetDraft() {
  for (const group of TOOL_GROUPS) {
    draftOrder.value[group.label] = [...group.tools]
  }
  draftHidden.value = []
}

function finishEdit() {
  editing.value = false
  configStore.set('sidebar_config', serializeSidebarConfig({
    order: draftOrder.value,
    hidden: draftHidden.value,
  }))
}

/** 编辑态切换某工具的显示 / 隐藏 */
function toggleDraftHidden(type: ToolType) {
  draftHidden.value = draftHidden.value.includes(type)
    ? draftHidden.value.filter(item => item !== type)
    : [...draftHidden.value, type]
}

/** 展开的分组标签，默认全部展开 */
const expandedGroups = ref<string[]>(TOOL_GROUPS.map(group => group.label))

/** 切换分组展开状态 */
function toggleGroup(label: string) {
  expandedGroups.value = expandedGroups.value.includes(label)
    ? expandedGroups.value.filter(item => item !== label)
    : [...expandedGroups.value, label]
}

/** 当前激活标签承载的工具类型 */
const activeToolType = computed(() => tabStore.activeTab?.toolType ?? '')

/**
 * 菜单项是否高亮。
 *  - 多例工具：有该类型的标签处于激活态（此时内容区展示的正是它）；
 *  - 单例工具：内容区当前展示的就是它的单例视图（单例不进标签栏）。
 */
function isActive(type: ToolType): boolean {
  const definition = toolOf(type)
  if (definition && !definition.multi) {
    return tabStore.activeSingleton === type
  }
  return activeToolType.value === type
}

/**
 * 菜单项悬浮提示。
 * 多例工具补充「点击在实例间切换」的说明，方便发现轮转行为。
 */
function titleOf(type: ToolType): string {
  const definition = toolOf(type)
  if (!definition) {
    return ''
  }
  return definition.multi
    ? `${definition.description}；点击在实例标签间切换`
    : definition.description
}

/**
 * 点击菜单项。
 *
 * 单例：跳转到已有标签（不存在则新建）。
 * 多例：在同类标签间轮转——
 *   - 还没有该类型的标签：新建一个；
 *   - 当前激活的不是该类型：选中第一个该类型标签；
 *   - 当前激活的正是该类型：选中下一个（到末尾回到第一个）。
 */
function handleSelect(type: ToolType) {
  // 编辑态点击菜单项不跳转，防误触
  if (editing.value) {
    return
  }

  const definition = toolOf(type)
  if (!definition) {
    return
  }

  if (!definition.multi) {
    tabStore.openTool(type)
    return
  }

  const sameKind = tabStore.tabs.filter(tab => tab.toolType === type)
  if (sameKind.length === 0) {
    tabStore.openTool(type, { newInstance: true })
    return
  }

  const currentIndex = sameKind.findIndex(tab => tab.id === tabStore.activeId)
  const next = currentIndex === -1
    ? sameKind[0]
    : sameKind[(currentIndex + 1) % sameKind.length]
  tabStore.setActive(next.id)
}

/** 多例工具：新建一个实例 */
function handleNewInstance(type: ToolType) {
  tabStore.openTool(type, { newInstance: true })
}
</script>

<template>
  <aside class="app-sidebar" :class="{ 'app-sidebar--collapsed': collapsed }">
    <nav class="app-sidebar__nav">
      <!--
        置顶菜单（首页）：排在分组菜单之前，与分组菜单之间用一条分隔线区分。
        对应 utils/tools.ts 的 PINNED_TOP_TOOLS。
      -->
      <ul
        v-show="editing || visiblePinnedTopTools.length > 0"
        class="app-sidebar__items app-sidebar__items--pinned"
      >
        <template v-if="editing">
          <li
            v-for="type in pinnedTopTools"
            :key="type"
            class="app-sidebar__item is-editing"
            :class="{ 'is-hidden': draftHidden.includes(type) }"
          >
            <span class="app-sidebar__handle is-static" aria-hidden="true" />
            <el-icon class="app-sidebar__icon">
              <component :is="toolOf(type)?.icon" />
            </el-icon>
            <span class="app-sidebar__label">{{ toolOf(type)?.label }}</span>
            <button
              class="app-sidebar__eye"
              type="button"
              :title="draftHidden.includes(type) ? '显示菜单' : '隐藏菜单'"
              @click.stop="toggleDraftHidden(type)"
            >
              <el-icon><Hide v-if="draftHidden.includes(type)" /><View v-else /></el-icon>
            </button>
          </li>
        </template>
        <template v-else>
          <li
            v-for="type in visiblePinnedTopTools"
            :key="type"
            class="app-sidebar__item"
            :class="{ 'is-active': isActive(type) }"
            :title="titleOf(type)"
            @click="handleSelect(type)"
          >
            <el-icon class="app-sidebar__icon">
              <component :is="toolOf(type)?.icon" />
            </el-icon>
            <span class="app-sidebar__label">{{ toolOf(type)?.label }}</span>
          </li>
        </template>
      </ul>

      <!-- 分组菜单 -->
      <section
        v-for="group in TOOL_GROUPS"
        :key="group.label"
        v-show="editing || isGroupVisible(group)"
        class="app-sidebar__group"
      >
        <button
          class="app-sidebar__group-head"
          type="button"
          @click="toggleGroup(group.label)"
        >
          <el-icon
            class="app-sidebar__arrow"
            :class="{ 'is-expanded': expandedGroups.includes(group.label) }"
          >
            <ArrowRight />
          </el-icon>
          <span>{{ group.label }}</span>
        </button>

        <!-- 编辑态：草稿列表，左侧拖动把手排序、右侧眼睛控制显示 -->
        <VueDraggable
          v-if="editing"
          v-model="draftOrder[group.label]"
          tag="ul"
          class="app-sidebar__items"
          handle=".app-sidebar__handle"
          :animation="220"
          easing="cubic-bezier(0.22, 1, 0.36, 1)"
        >
          <li
            v-for="type in draftOrder[group.label]"
            :key="type"
            class="app-sidebar__item is-editing"
            :class="{ 'is-hidden': draftHidden.includes(type) }"
          >
            <el-icon class="app-sidebar__handle" title="拖动排序"><DCaret /></el-icon>
            <el-icon class="app-sidebar__icon">
              <component :is="toolOf(type)?.icon" />
            </el-icon>
            <span class="app-sidebar__label">{{ toolOf(type)?.label }}</span>
            <button
              class="app-sidebar__eye"
              type="button"
              :title="draftHidden.includes(type) ? '显示菜单' : '隐藏菜单'"
              @click.stop="toggleDraftHidden(type)"
            >
              <el-icon><Hide v-if="draftHidden.includes(type)" /><View v-else /></el-icon>
            </button>
          </li>
        </VueDraggable>

        <!-- 普通态：按配置顺序渲染可见菜单 -->
        <ul
          v-else
          v-show="expandedGroups.includes(group.label)"
          class="app-sidebar__items"
        >
          <li
            v-for="type in visibleGroupTools(group)"
            :key="type"
            class="app-sidebar__item"
            :class="{ 'is-active': isActive(type) }"
            :title="titleOf(type)"
            @click="handleSelect(type)"
          >
            <el-icon class="app-sidebar__icon">
              <component :is="toolOf(type)?.icon" />
            </el-icon>
            <span class="app-sidebar__label">{{ toolOf(type)?.label }}</span>

            <!-- 多例工具：右侧 + 新建实例 -->
            <button
              v-if="toolOf(type)?.multi"
              class="app-sidebar__add"
              type="button"
              title="新建实例"
              @click.stop="handleNewInstance(type)"
            >
              <el-icon><Plus /></el-icon>
            </button>
          </li>
        </ul>
      </section>

      <!-- 贴底的顶级菜单项（设置）：不可拖动排序，可隐藏 -->
      <ul
        v-show="editing || visibleBottomTopTools.length > 0"
        class="app-sidebar__items app-sidebar__items--top"
      >
        <template v-if="editing">
          <li
            v-for="type in bottomTopTools"
            :key="type"
            class="app-sidebar__item is-editing"
            :class="{ 'is-hidden': draftHidden.includes(type) }"
          >
            <span class="app-sidebar__handle is-static" aria-hidden="true" />
            <el-icon class="app-sidebar__icon">
              <component :is="toolOf(type)?.icon" />
            </el-icon>
            <span class="app-sidebar__label">{{ toolOf(type)?.label }}</span>
            <button
              class="app-sidebar__eye"
              type="button"
              :title="draftHidden.includes(type) ? '显示菜单' : '隐藏菜单'"
              @click.stop="toggleDraftHidden(type)"
            >
              <el-icon><Hide v-if="draftHidden.includes(type)" /><View v-else /></el-icon>
            </button>
          </li>
        </template>
        <template v-else>
          <li
            v-for="type in visibleBottomTopTools"
            :key="type"
            class="app-sidebar__item"
            :class="{ 'is-active': isActive(type) }"
            :title="titleOf(type)"
            @click="handleSelect(type)"
          >
            <el-icon class="app-sidebar__icon">
              <component :is="toolOf(type)?.icon" />
            </el-icon>
            <span class="app-sidebar__label">{{ toolOf(type)?.label }}</span>
          </li>
        </template>
      </ul>
    </nav>

    <!-- 底部操作区：编辑菜单排序与显示 -->
    <footer class="app-sidebar__footer">
      <template v-if="editing">
        <button class="app-sidebar__footer-btn" type="button" @click="resetDraft">
          恢复默认
        </button>
        <button
          class="app-sidebar__footer-btn is-primary"
          type="button"
          title="保存排序与显示设置"
          @click="finishEdit"
        >
          完成
        </button>
      </template>
      <button
        v-else
        class="app-sidebar__footer-btn"
        type="button"
        title="编辑菜单排序与显示"
        @click="enterEdit"
      >
        <el-icon><Edit /></el-icon>
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.app-sidebar {
  display: flex;
  flex-direction: column;
  /* 宽度取自全局 token（--sidebar-width: 240px / 收起 64px） */
  flex: 0 0 var(--sidebar-width);
  width: var(--sidebar-width);
  min-width: 0;
  overflow: hidden;
  background: var(--panel-bg);
  border-right: 1px solid var(--border-color);
  transition: flex-basis 0.18s ease, width 0.18s ease;
}

/* ------------------------------------------------------------ 收起态（64px 图标栏） */

/*
 * 收起后只保留图标：标签文字、新建按钮、编辑把手、分组标题全部隐藏，
 * 分组之间用分隔线区分；每个图标仍带 title 悬浮提示，功能不失可发现性。
 */
.app-sidebar--collapsed {
  flex-basis: var(--sidebar-width-collapsed);
  width: var(--sidebar-width-collapsed);
}

.app-sidebar--collapsed .app-sidebar__nav {
  padding: 10px 6px;
}

.app-sidebar--collapsed .app-sidebar__label,
.app-sidebar--collapsed .app-sidebar__add,
.app-sidebar--collapsed .app-sidebar__handle,
.app-sidebar--collapsed .app-sidebar__eye,
.app-sidebar--collapsed .app-sidebar__group-head {
  display: none;
}

.app-sidebar--collapsed .app-sidebar__item {
  justify-content: center;
  padding: 0;
}

.app-sidebar--collapsed .app-sidebar__group + .app-sidebar__group {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border-color);
}

.app-sidebar--collapsed .app-sidebar__items--top {
  margin-top: 6px;
  padding-top: 6px;
}

.app-sidebar--collapsed .app-sidebar__items--pinned {
  margin-bottom: 6px;
  padding-bottom: 6px;
}

.app-sidebar--collapsed .app-sidebar__footer {
  justify-content: center;
  padding: 8px 6px;
}

.app-sidebar__nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-height: 0;
  padding: 10px 8px;
  overflow-y: auto;
}

/* 分组标题 */
.app-sidebar__group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
  letter-spacing: 0.4px;
  text-align: left;
  cursor: pointer;
}

.app-sidebar__group-head:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.app-sidebar__arrow {
  font-size: var(--app-font-size-sm);
  transition: transform 0.18s ease;
}

.app-sidebar__arrow.is-expanded {
  transform: rotate(90deg);
}

.app-sidebar__items {
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
}

.app-sidebar__items--top {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
}

/* 置顶段（首页）：排在分组菜单之上，用下边框与分组菜单分开 */
.app-sidebar__items--pinned {
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}

/* 菜单项 */
.app-sidebar__item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: calc(32px * var(--app-control-scale));
  margin-bottom: 2px;
  padding: 0 6px 0 22px;
  border-radius: 6px;
  color: var(--text-color);
  font-size: var(--app-font-size);
  cursor: pointer;
  user-select: none;
}

.app-sidebar__item:hover {
  background: var(--hover-bg);
}

.app-sidebar__item.is-active {
  background: var(--active-bg);
  color: var(--brand-color);
}

.app-sidebar__icon {
  font-size: var(--app-font-size-lg);
  color: var(--text-muted);
}

.app-sidebar__item.is-active .app-sidebar__icon {
  color: var(--brand-color);
}

.app-sidebar__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 多例工具的新建按钮：常驻但弱化，悬浮时强化，保证可发现性 */
.app-sidebar__add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: calc(20px * var(--app-control-scale));
  height: calc(20px * var(--app-control-scale));
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 0.15s ease, background-color 0.15s ease;
}

.app-sidebar__item:hover .app-sidebar__add {
  opacity: 1;
}

/* ------------------------------------------------------------ 编辑态 */

/* 拖动把手：仅编辑态渲染 */
.app-sidebar__handle {
  flex: 0 0 auto;
  color: var(--text-muted);
  opacity: 0.7;
  cursor: grab;
}

.app-sidebar__handle:active {
  cursor: grabbing;
}

/* 顶级项不可拖，占位保持与组内项对齐 */
.app-sidebar__handle.is-static {
  opacity: 0.2;
  cursor: default;
}

/* 显示 / 隐藏切换 */
.app-sidebar__eye {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: calc(22px * var(--app-control-scale));
  height: calc(22px * var(--app-control-scale));
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.app-sidebar__eye:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

/* 编辑态菜单项不响应跳转；隐藏项整体变淡 */
.app-sidebar__item.is-editing {
  cursor: default;
}

.app-sidebar__item.is-hidden {
  opacity: 0.45;
}

/* 底部操作区 */
.app-sidebar__footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid var(--border-color);
}

.app-sidebar__footer-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--app-font-size-sm);
  cursor: pointer;
}

.app-sidebar__footer-btn:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.app-sidebar__footer-btn.is-primary {
  color: var(--brand-color);
}

.app-sidebar__add:hover {
  background: var(--brand-color);
  color: #fff;
}
</style>
