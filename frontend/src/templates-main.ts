/**
 * SQL 模板管理窗口的入口脚本。
 *
 * 说明：
 *  - 该窗口是 v3 的独立 webview，与主窗口（main.ts）拥有完全独立的
 *    JS 上下文：Pinia store、已加载的 Monaco 实例等均不共享。
 *  - 窗口之间通过 Wails 事件通信（如 templates:changed），
 *    模板窗口保存/删除模板后广播，主窗口监听并刷新列表。
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './views/TemplateManagerApp.vue'
import { setupMonaco } from './utils/monaco'
import { useConfigStore } from './stores/configStore'
import { useDictStore } from './stores/dictStore'

import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/global.css'

// Monaco worker 使用本地打包资源，必须在渲染编辑器前完成配置
setupMonaco()

const app = createApp(App)

for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component)
}

app.use(createPinia())
app.use(ElementPlus, { locale: zhCn })

// 应用全局主题与字号（独立窗口也需保持一致的观感）
const configStore = useConfigStore()
void configStore.load()

// 词典数据供「绑定词典」下拉使用（独立窗口需自行加载）
const dictStore = useDictStore()
void dictStore.loadAll()

app.mount('#app')
