<script setup lang="ts">
import { onMounted, ref } from 'vue'
import TitleBar from '@/components/TitleBar.vue'
import ConfirmHost from '@/components/ui/ConfirmHost.vue'
import Toaster from '@/components/ui/Toaster.vue'
import ContextMenu from '@/components/ContextMenu.vue'
import WindowResizeEdges from '@/components/WindowResizeEdges.vue'
import Workbench from '@/layouts/Workbench.vue'
import { closeWindow, openDevTools, toggleMaximiseWindow } from '@/api/window'
import { useConfigStore } from '@/stores/configStore'
import { useLogStore } from '@/stores/logStore'
import { useTabStore } from '@/stores/tabStore'
import type { ContextMenuAction } from '@/types'
import { matchesShortcut, shortcutOf } from '@/utils/shortcuts'

const configStore = useConfigStore()
const logStore = useLogStore()
const tabStore = useTabStore()

/** 自定义右键菜单状态（仅标题栏触发） */
const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)

/** 打开设置：设置已改为单例标签页，不存在则新建并跳转 */
function openSettings() {
  tabStore.openTool('settings')
}

/** 标题栏系统右键菜单项 */
const titleBarMenuItems: ContextMenuAction[] = [
  { key: 'toggle-maximise', label: '最大化 / 还原', shortcut: '双击标题栏' },
  { key: 'reload', label: '重新载入界面', shortcut: 'Ctrl+R', divided: true },
  // 调试用：打开 WebView 的开发者工具（与 F12 相同），方便查样式
  { key: 'devtools', label: '检查元素', shortcut: 'F12', divided: true },
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
    case 'devtools':
      openDevTools()
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
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) {
      return
    }
    if (matchesShortcut(event, shortcutOf('open-settings', configStore.values.shortcut_config))) {
      event.preventDefault()
      openSettings()
    }
  })
})
</script>

<template>
  <!-- 注意：这里不接管右键，右键菜单仅在标题栏触发 -->
  <div class="app-root">
    <!-- 自定义顶部工具栏：系统菜单与设置入口都在这里 -->
    <TitleBar
      title="Toolbox"
      @close="closeWindow"
      @settings="openSettings"
      @context-menu="openContextMenu"
    />

    <main class="app-main app-main--flush">
      <Workbench />
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

    <!--
      全局反馈宿主：各挂一个即可（内部 Teleport 到 body）。
      提示与确认框都是「命令式调用 + 全局队列」，所以放在应用根部而不是逐页挂载。
    -->
    <Toaster />
    <ConfirmHost />
  </div>
</template>

<style scoped>
/* 工作台自行管理内部滚动，外层不再叠加内边距与滚动 */
.app-main--flush {
  overflow: hidden;
}
</style>
