/**
 * Monaco Editor 本地化配置。
 *
 * 背景：@guolao/vue-monaco-editor 默认从 CDN 加载 Monaco 资源，
 * 而桌面应用运行时可能无外网访问，必须改为使用本地打包的资源。
 *
 * 路径说明（重要）：
 * monaco-editor 0.56 的 package.json 中 exports 映射为
 *   "./*": "./esm/vs/*.js"
 * 因此导入 worker 时必须写成 "monaco-editor/editor/editor.worker"，
 * 不能写 "monaco-editor/esm/vs/editor/editor.worker"，
 * 否则会被解析为 esm/vs/esm/vs/... 而报找不到文件。
 */

import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { loader } from '@guolao/vue-monaco-editor'

/** 是否已完成初始化，避免重复配置 */
let initialized = false

/** 初始化 Monaco：注册 worker 与本地实例 */
export function setupMonaco() {
  if (initialized) {
    return
  }
  initialized = true

  // 按语言分配对应 worker，SQL 复用编辑器基础 worker。
  // 使用 globalThis 赋值以匹配 monaco 声明的全局变量。
  globalThis.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
        case 'json':
          return new jsonWorker()
        case 'css':
        case 'scss':
        case 'less':
          return new cssWorker()
        case 'html':
        case 'handlebars':
        case 'razor':
          return new htmlWorker()
        case 'typescript':
        case 'javascript':
          return new tsWorker()
        default:
          return new editorWorker()
      }
    },
  }

  // 使用本地打包的 monaco 实例，禁止回退到 CDN
  loader.config({ monaco })
}
