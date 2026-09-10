<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElConfigProvider } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import TitleBar from '@/components/TitleBar.vue'
import ContextMenu from '@/components/ContextMenu.vue'
import WindowResizeEdges from '@/components/WindowResizeEdges.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import TabLayout from '@/layouts/TabLayout.vue'
import { closeWindow, toggleMaximiseWindow } from '@/api/window'
import { useConfigStore } from '@/stores/configStore'
import { useLogStore } from '@/stores/logStore'
import type { ContextMenuAction } from '@/types'

const configStore = useConfigStore()
const logStore = useLogStore()

/** 自定义右键菜单状态（仅标题栏触发） */
const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)

/** 设置面板 */
const settingsVisible = ref(false)

/** 标题栏系统右键菜单项 */
const titleBarMenuItems: ContextMenuAction[] = [
  { key: 'toggle-maximise', label: '最大化 / 还原', shortcut: '双击标题栏' },
  { key: 'reload', label: '重新载入界面', shortcut: 'Ctrl+R', divided: true },
  { key: 'close', label: '退出应用', danger: true },
]

/** 打开右键菜单（仅由标题栏调用） */
function openContextMenu(payload: { x: number, y: number }) {
  menuX.value = payload.x
  menuY.value = payload.y
  menuVisible.value = true
}

/** 处理标题栏菜单项点击 */
function handleMenuSelect(item: ContextMenuAction) {
  switch (item.key) {
    case 'toggle-maximise':
      toggleMaximiseWindow()
      break
    case 'reload':
      window.location.reload()
      break
    case 'close':
      closeWindow()
      break
    default:
      break
  }
}

onMounted(async () => {
  // 启动时加载全局配置并应用主题/字号
  await configStore.load()
  logStore.setMaxLines(configStore.logMaxLines)
})
</script>

<template>
  <!--
    ElConfigProvider 负责把「控件大小」全局下发给所有 Element Plus 组件。
    注意：这里不接管右键，右键菜单仅在标题栏触发。
  -->
  <ElConfigProvider :locale="zhCn" :size="configStore.controlSize">
    <div class="app-root">
      <!-- 自定义顶部工具栏：系统菜单与设置入口都在这里 -->
      <TitleBar
        title="Toolbox"
        @settings="settingsVisible = true"
        @context-menu="openContextMenu"
      />

      <main class="app-main app-main--flush">
        <TabLayout />
      </main>

      <!-- 窗口四周缩放宽边热区 -->
      <WindowResizeEdges />

      <!-- 标题栏系统右键菜单 -->
      <ContextMenu
        v-model:visible="menuVisible"
        :x="menuX"
        :y="menuY"
        :items="titleBarMenuItems"
        @select="handleMenuSelect"
      />

      <!-- 设置面板 -->
      <SettingsPanel v-model:visible="settingsVisible" />
    </div>
  </ElConfigProvider>
</template>

<style scoped>
/* 工作台自行管理内部滚动，外层不再叠加内边距与滚动 */
.app-main--flush {
  overflow: hidden;
}
</style>
