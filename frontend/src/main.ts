import { createApp, watchEffect } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import { syncWindowBackground } from './api/window'
import { installTitleTooltip } from './utils/tooltip'
import { useConfigStore } from './stores/configStore'

import 'element-plus/dist/index.css'
// Element Plus 暗色主题，与自定义工具栏配色保持一致
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/global.css'
// 模板管理弹窗内面板的表单样式规范（变量配置 / 字段映射共用）
import './styles/template-panels.css'

const app = createApp(App)

// 注册 Element Plus 图标组件
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component)
}

app.use(createPinia())
app.use(ElementPlus, { locale: zhCn })

// 主题由 configStore 在启动时从后端配置读取并应用，
// 这里先默认暗色，避免首帧闪白。
document.documentElement.classList.add('dark')

/**
 * 全局屏蔽浏览器默认右键菜单。
 *
 * 只有「真正的输入场景」保留原生菜单（便于复制/粘贴），
 * 编辑器（CM6）内部的 contenteditable 不算输入场景，其右键菜单一并关闭。
 * 后续需要右键菜单的位置，由对应组件自行渲染自定义菜单。
 */
document.addEventListener('contextmenu', (event) => {
  if (shouldKeepNativeMenu(event.target)) {
    return
  }
  event.preventDefault()
})

/** 判断事件目标是否属于需要保留原生菜单的输入控件 */
function shouldKeepNativeMenu(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  // CM6 的编辑区是 contenteditable，必须显式排除，否则会命中下面的输入豁免
  if (target.closest('.cm-editor')) {
    return false
  }
  return Boolean(target.closest('input, textarea, [contenteditable="true"]'))
}

app.mount('#app')

// 把原生 title 提示换成应用自己的小提示（样式见 global.css 的 #app-tip）
installTitleTooltip()

// 主题变化时同步窗口底色：窗口重绘时擦出的底色与页面一致，避免闪黑/闪白
// （配置由 App.vue 加载，这里只跟随结果，不重复请求）
const configStore = useConfigStore()
watchEffect(() => syncWindowBackground(configStore.theme))
