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

app.mount('#app')
