/** 信息卡片中的单条数据 */
export interface InfoItem {
  label: string
  value: string
}

/** 自定义右键菜单的菜单项定义 */
export interface ContextMenuAction {
  /** 唯一标识 */
  key: string
  /** 显示文案 */
  label: string
  /** 可选的快捷键提示，仅用于展示 */
  shortcut?: string
  /** 是否禁用 */
  disabled?: boolean
  /** 是否为危险操作（如删除、退出） */
  danger?: boolean
  /** 该项之后插入分割线 */
  divided?: boolean
}

/**
 * 已实现的工具类型。
 * 注意：后端 database.Tab.ToolType 为 string，
 * 因此 WorkbenchTab.toolType 保持 string，此联合类型仅用于工具选择处的约束。
 */
export type ToolType = 'db-query' | 'placeholder'

/** 工作台 Tab，与后端 database.Tab 对应 */
export interface WorkbenchTab {
  id: number
  name: string
  sortOrder: number
  isActive: boolean
  isLocked: boolean
  /** 工具标识；'placeholder' 表示尚未绑定工具 */
  toolType: string
  /** 各工具私有状态的 JSON 字符串 */
  payload: string
  schemaVersion: number
}

/** 数据库连接配置，与后端 database.DBConnection 对应 */
export interface DBConnection {
  id: number
  name: string
  dbType: string
  host: string
  port: number
  database: string
  username: string
  password: string
  extra: string
}

/** SQL 模板配置，与后端 database.SQLTemplate 对应 */
export interface SQLTemplate {
  id: number
  connId: number
  name: string
  sqlText: string
  /** JSON: 变量 UI 配置 */
  variables: string
  /** JSON: 字段映射配置 */
  fieldMappings: string
  preScript: string
  postScript: string
  /** 查询结果是否分页展示 */
  paginationEnabled: boolean
  /** 每页条数保留字段：实际页大小由每个标签页的翻页控件决定 */
  pageSize?: number
}

/** 词典，与后端 database.Dictionary 对应 */
export interface Dictionary {
  id: number
  name: string
  description: string
}

/** 词典项，与后端 database.DictionaryItem 对应 */
export interface DictionaryItem {
  id: number
  dictionaryId: number
  value: string
  meaning: string
  description: string
  sortOrder: number
}

/** 结果集列元信息，与后端 services.ColumnMeta 对应 */
export interface ColumnMeta {
  name: string
  type: string
}

/** 查询结果，与后端 services.QueryResult 对应 */
export interface QueryResult {
  columns: ColumnMeta[]
  rows: Record<string, unknown>[]
  sql: string
  elapsedMs: number
  rowCount: number
  truncated: boolean
  /** 满足条件的数据总量；未分页时等于 rowCount */
  total: number
  /** 当前页码，从 1 开始；未分页时为 1 */
  page: number
  /** 每页条数；未分页时为 0 */
  pageSize: number
  /** 总页数；未分页时为 1 */
  pageCount: number
}

/** 查询请求，与后端 services.ExecuteRequest 对应 */
export interface ExecuteRequest {
  connId: number
  sqlTemplate: string
  variables: Record<string, unknown>
  preScript: string
  postScript: string
  /** 页码，从 1 开始；小于等于 0 表示不分页 */
  page?: number
  /** 每页条数；小于等于 0 时取后端默认值 */
  pageSize?: number
  /** 上一次的总数；翻页时带回可跳过重新统计 */
  total?: number
  /** 是否重新统计总数 */
  countTotal?: boolean
}

/** 模板执行请求，与后端 services.TemplateExecuteRequest 对应 */
export interface TemplateExecuteRequest {
  templateId: number
  connId: number
  variables: Record<string, unknown>
  /** 页码，从 1 开始；仅模板开启分页时生效 */
  page?: number
  /** 每页条数；小于等于 0 时取后端默认值 */
  pageSize?: number
  /** 上一次返回的总数；翻页时带回可跳过重新统计 */
  total?: number
  /** 是否重新统计总数；翻页时为 false，重新执行时为 true */
  countTotal?: boolean
}



/** 模板列表项（含截断的 SQL 预览），与后端 services.TemplateListItem 对应 */
export interface TemplateListItem {
  id: number
  name: string
  connId: number
  sqlText: string
}

/** 应用配置项，与后端 database.Setting 对应 */
export interface Setting {
  key: string
  type: string
  value: string
}

/** 全局配置的键名 */
export type SettingKey =
  | 'theme'
  | 'font_size'
  | 'control_size'
  | 'editor_font_size'
  | 'log_max_lines'

/** 主题模式 */
export type ThemeMode = 'dark' | 'light'

/** Element Plus 控件尺寸 */
export type ControlSize = 'large' | 'default' | 'small'

/** 变量可选的 UI 组件类型 */
export type VariableComponent =
  | 'input'
  | 'textarea'
  | 'select'
  | 'multi-select'
  | 'date-picker'
  | 'slider'
  | 'switch'

/** 变量数据类型 */
export type VariableDataType = 'string' | 'int' | 'float' | 'bool' | 'date'

/** 下拉选项 */
export interface VariableOption {
  label: string
  value: string
}

/** 变量的动态选项来源配置 */
export interface VariableDynamicOption {
  /** 取选项的 SQL */
  sql: string
  /** 作为 value 的列名 */
  valueColumn: string
  /** 作为 label 的列名 */
  labelColumn: string
}

/** 变量 UI 元数据配置 */
export interface VariableConfig {
  /** 变量名，与模板中的标识符一致 */
  name: string
  /** 展示名称 */
  label: string
  /** 渲染组件类型 */
  component: VariableComponent
  /** 数据类型，决定传往后端的值的类型 */
  dataType: VariableDataType
  /** 默认值 */
  defaultValue?: unknown
  /** 静态选项（select / multi-select 使用） */
  options?: VariableOption[]
  /** 动态选项来源（select / multi-select 使用） */
  dynamicOptions?: VariableDynamicOption
  /** 数字输入的取值范围（slider 使用） */
  min?: number
  max?: number
  step?: number
  /** 占位提示 */
  placeholder?: string
}

/** 单元格展示模板配置 */
export interface FieldMapping {
  /** 结果集中的列名 */
  column: string
  /** 展示别名 */
  label: string
  /** 列宽，留空则自适应 */
  width?: number
  /** 对齐方式 */
  align?: 'left' | 'center' | 'right'
  /** 绑定的词典 ID，用于翻译单元格值 */
  dictionaryId?: number
  /**
   * 展示模板，支持 {{value}} 与 {{meaning}} 占位符。
   * 例：{{value}} - {{meaning}}
   */
  template?: string
}

/**
 * 数据库查询工具在 Tab payload 中保存的状态。
 *
 * 说明：SQL、变量配置、字段映射、脚本等均已归属到「SQL 模板」，
 * 查询 Tab 只保存「引用哪个模板」与「用哪个连接」，执行时由后端取模板渲染。
 * 这样模板更新后引用它的 Tab 无需同步即可生效。
 */
export interface DbQueryPayload {
  /** 引用的模板 ID */
  templateId: number | null
  /** 当前选中的连接；为空时回退到模板自身配置的连接 */
  connId: number | null
  /** 上次填写的变量值，用于恢复表单 */
  variableValues?: Record<string, unknown>
  /** 该标签自己的每页条数，不随模板保存 */
  pageSize?: number
}
