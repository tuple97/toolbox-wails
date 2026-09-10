import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import { setupMonaco } from './utils/monaco'

import 'element-plus/dist/index.css'
// Element Plus 暗色主题，与自定义工具栏配色保持一致
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/global.css'

// Monaco 使用本地打包资源，必须在渲染编辑器前完成配置
setupMonaco()

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
 * Monaco 内部的隐藏输入框不算输入场景，它自带的右键菜单也一并关闭。
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
  if (target.closest('.monaco-editor')) {
    return false
  }
  return Boolean(target.closest('input, textarea, [contenteditable="true"]'))
}

app.mount('#app')
