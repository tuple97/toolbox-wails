/** 工具注册表（左侧菜单、新建下拉、标签内容区的渲染都以本表为准） */

import type { ToolType } from '@/types'

export interface ToolDefinition {
  type: ToolType
  /** 菜单与标签上展示的名称 */
  label: string
  /** 图标名（自绘图标库 utils/icons.ts） */
  icon: string
  /** 是否多例：多例工具可同时打开多个标签，单例工具全局只有一个 */
  multi: boolean
  /** 单行说明，用于菜单悬浮提示 */
  description: string
}

export const TOOLS: ToolDefinition[] = [
  {
    type: 'home',
    label: '首页',
    icon: 'home',
    multi: false,
    description: '工作台首页（单例标签）',
  },
  {
    type: 'connections',
    label: '连接管理',
    icon: 'link',
    multi: false,
    description: '维护数据库连接（单例标签）',
  },
  {
    type: 'sql-template',
    label: 'SQL 模板',
    icon: 'document',
    multi: false,
    description: '维护 SQL 模板与变量配置（单例标签）',
  },
  {
    type: 'db-query',
    label: 'SQL 查询',
    icon: 'search',
    multi: true,
    description: '按模板执行查询（多例标签，可同时打开多个）',
  },
  {
    type: 'command-executor',
    label: 'SQL 执行',
    // 图标名必须存在于自绘图标库（utils/icons.ts）
    icon: 'terminal',
    multi: true,
    description: '自由编写并执行 SQL，支持取消与智能补全',
  },
  {
    type: 'dictionary',
    label: '词典',
    icon: 'book',
    multi: false,
    description: '维护本地词典数据（单例标签）',
  },
  {
    type: 'settings',
    label: '设置',
    icon: 'settings',
    multi: false,
    description: '应用外观与行为设置（单例标签）',
  },
]

/** 左侧菜单分组；未列入分组的工具作为顶级菜单项展示 */
export interface ToolGroup {
  label: string
  tools: ToolType[]
}

export const TOOL_GROUPS: ToolGroup[] = [
  { label: '数据库', tools: ['connections', 'sql-template', 'db-query', 'command-executor'] },
  { label: '本地记录', tools: ['dictionary'] },
]

/** 顶级（不分组）工具，顺序即渲染顺序 */
export const TOP_LEVEL_TOOLS: ToolType[] = ['home', 'settings']

/** 置顶渲染的顶级工具（首页） */
export const PINNED_TOP_TOOLS: ToolType[] = ['home']

/** 按类型取工具定义 */
export function toolOf(type: string): ToolDefinition | undefined {
  return TOOLS.find(tool => tool.type === type)
}

/** 多例工具，供「新建标签」下拉使用 */
export function multiTools(): ToolDefinition[] {
  return TOOLS.filter(tool => tool.multi)
}

/** 工具默认名称 */
export function toolLabelOf(type: string): string {
  return toolOf(type)?.label ?? type
}
