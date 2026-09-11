/**
 * Wails v3 绑定入口（由 wails3 CLI 生成，勿手动修改生成文件）。
 *
 * v3 生成结构说明：
 *  - `bindings/toolbox-wails/app/app.js`：全部绑定方法（本文件直接导入它）
 *  - `bindings/toolbox-wails/app/models.js`：数据模型类型
 *  - `bindings/toolbox-wails/app/index.js`：聚合入口，`export { App }` 命名空间形式
 *  - 生成代码依赖 npm 包 `@wailsio/runtime`（import 即激活拖动/右键等副作用）
 *
 * 这里把方法逐个透传导出，使各 API 文件保持
 * `import { ListTabs } from './bindings'` 的写法不变，
 * 同时保留生成代码 JSDoc 中的参数与返回类型。
 *
 * 新增后端方法后的流程：
 *   1. pnpm gen:bindings
 *   2. 在下方对应分组补一行 `export const 方法名 = App.方法名`
 */

// 注意：必须从 app.js 导入（方法直接导出）。
// 若从 index.js 导入，拿到的是 { App } 命名空间，方法会多包一层。
import * as App from '@bindings/toolbox-wails/app/app.js'

// ---- Tab 工作台 ----
export const ListTabs = App.ListTabs
export const SaveTabs = App.SaveTabs

// ---- 数据库连接与查询 ----
export const ListConnections = App.ListConnections
export const GetConnection = App.GetConnection
export const SaveConnection = App.SaveConnection
export const DeleteConnection = App.DeleteConnection
export const TestConnection = App.TestConnection
export const RevealPassword = App.RevealPassword
export const ExecuteQuery = App.ExecuteQuery
export const QueryVariableOptions = App.QueryVariableOptions

// ---- SQL 模板 ----
export const ListSqlTemplates = App.ListSqlTemplates
export const GetSqlTemplate = App.GetSqlTemplate
export const SaveSqlTemplate = App.SaveSqlTemplate
export const DeleteSqlTemplate = App.DeleteSqlTemplate
export const ExtractTemplateVariables = App.ExtractTemplateVariables
export const PreviewTemplate = App.PreviewTemplate
export const ValidateScript = App.ValidateScript
export const ExecuteTemplateQuery = App.ExecuteTemplateQuery

// ---- 词典 ----
export const ListDictionaries = App.ListDictionaries
export const SaveDictionary = App.SaveDictionary
export const DeleteDictionary = App.DeleteDictionary
export const ListDictionaryItems = App.ListDictionaryItems
export const SaveDictionaryItems = App.SaveDictionaryItems
export const LoadDictionaryCache = App.LoadDictionaryCache

// ---- 全局配置 ----
export const GetAllSettings = App.GetAllSettings
export const SaveSetting = App.SaveSetting

// ---- 窗口控制 ----
export const WindowMinimise = App.WindowMinimise
export const WindowToggleMaximise = App.WindowToggleMaximise
export const WindowIsMaximised = App.WindowIsMaximised
export const WindowClose = App.WindowClose

// ---- 多窗口管理 ----
export const OpenTemplatesWindow = App.OpenTemplatesWindow
