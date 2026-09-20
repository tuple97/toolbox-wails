// Wails v3 绑定入口，逐个透传导出生成的方法

// 必须从 app.js 导入；从 index.js 导入拿到的是 { App } 命名空间
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

// ---- 命令执行器 ----
export const ExecuteStatement = App.ExecuteStatement
export const ListDatabases = App.ListDatabases
export const ListTables = App.ListTables
export const ListTableColumns = App.ListTableColumns
export const ListForeignKeys = App.ListForeignKeys
export const FetchCreateTableSQL = App.FetchCreateTableSQL

// ---- SQL 模板 ----
export const ListSqlTemplates = App.ListSqlTemplates
export const GetSqlTemplate = App.GetSqlTemplate
export const SaveSqlTemplate = App.SaveSqlTemplate
export const DeleteSqlTemplate = App.DeleteSqlTemplate
export const ExtractTemplateVariables = App.ExtractTemplateVariables
export const PreviewTemplate = App.PreviewTemplate
export const ValidateScript = App.ValidateScript
export const ValidateTemplate = App.ValidateTemplate
export const ExecuteTemplateQuery = App.ExecuteTemplateQuery
export const RenderExportTemplate = App.RenderExportTemplate
export const CheckUpdate = App.CheckUpdate
export const DownloadUpdate = App.DownloadUpdate
export const RestartToApplyUpdate = App.RestartToApplyUpdate
export const UpdateState = App.UpdateState

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
export const ListSystemFonts = App.ListSystemFonts

// ---- 应用信息 ----
export const GetAppInfo = App.GetAppInfo

export const WindowMinimise = App.WindowMinimise
export const WindowToggleMaximise = App.WindowToggleMaximise
export const WindowIsMaximised = App.WindowIsMaximised
export const WindowClose = App.WindowClose
