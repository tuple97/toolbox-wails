/**
 * 工具注册表。
 *
 * 左侧菜单、顶部标签栏的「新建」下拉、以及标签内容区的渲染都以本表为准，
 * 新增功能只需在这里补一项 + 在 Workbench 里补一条渲染分支。
 */

import type { ToolType } from '@/types'

export interface ToolDefinition {
  type: ToolType
  /** 菜单与标签上展示的名称 */
  label: string
  /** Element Plus 图标组件名（全局已注册） */
  icon: string
  /**
   * 是否多例：多例工具可同时打开多个标签（如 SQL 查询），
   * 单例工具全局只有一个标签，再次打开只会跳转过去。
   */
  multi: boolean
  /** 单行说明，用于菜单悬浮提示 */
  description: string
}

export const TOOLS: ToolDefinition[] = [
  {
    type: 'connections',
    label: '连接管理',
    icon: 'Link',
    multi: false,
    description: '维护数据库连接（单例标签）',
  },
  {
    type: 'sql-template',
    label: 'SQL 模板',
    icon: 'Document',
    multi: false,
    description: '维护 SQL 模板与变量配置（单例标签）',
  },
  {
    type: 'db-query',
    label: 'SQL 查询',
    icon: 'Search',
    multi: true,
    description: '按模板执行查询（多例标签，可同时打开多个）',
  },
  {
    type: 'dictionary',
    label: '词典',
    icon: 'Collection',
    multi: false,
    description: '维护本地词典数据（单例标签）',
  },
  {
    type: 'settings',
    label: '设置',
    icon: 'Setting',
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
  { label: '数据库', tools: ['connections', 'sql-template', 'db-query'] },
  { label: '本地记录', tools: ['dictionary'] },
]

/** 顶级（不分组）工具 */
export const TOP_LEVEL_TOOLS: ToolType[] = ['settings']

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
