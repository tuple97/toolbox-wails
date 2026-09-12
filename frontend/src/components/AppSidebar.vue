<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTabStore } from '@/stores/tabStore'
import { TOOL_GROUPS, TOP_LEVEL_TOOLS, toolOf } from '@/utils/tools'
import type { ToolType } from '@/types'

defineProps<{
  /** 是否收起（收起后由标签栏的按钮展开） */
  collapsed: boolean
}>()

const tabStore = useTabStore()

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
 * 多例工具只要有一个该类型的标签处于激活态就高亮。
 */
function isActive(type: ToolType): boolean {
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
      <!-- 分组菜单 -->
      <section v-for="group in TOOL_GROUPS" :key="group.label" class="app-sidebar__group">
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

        <ul v-show="expandedGroups.includes(group.label)" class="app-sidebar__items">
          <li
            v-for="type in group.tools"
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

      <!-- 顶级菜单项（设置等） -->
      <ul class="app-sidebar__items app-sidebar__items--top">
        <li
          v-for="type in TOP_LEVEL_TOOLS"
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
      </ul>
    </nav>
  </aside>
</template>

<style scoped>
.app-sidebar {
  flex: 0 0 208px;
  width: 208px;
  min-width: 0;
  overflow: hidden;
  background: var(--panel-bg);
  border-right: 1px solid var(--border-color);
  transition: flex-basis 0.18s ease, width 0.18s ease;
}

.app-sidebar--collapsed {
  flex-basis: 0;
  width: 0;
  border-right: none;
}

.app-sidebar__nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  height: 100%;
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

.app-sidebar__add:hover {
  background: var(--brand-color);
  color: #fff;
}
</style>
