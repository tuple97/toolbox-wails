import { ListTabs, SaveTabs } from './bindings'
import type { WorkbenchTab } from '@/types'

/**
 * 读取全部工作台 Tab。
 *
 * 后端返回的 database.Tab 与前端 WorkbenchTab 字段一一对应，
 * 但 Wails 生成的是 class 类型，这里显式映射保证类型安全。
 */
export async function fetchTabs(): Promise<WorkbenchTab[]> {
  const list = await ListTabs()
  return list.map(item => ({
    id: item.id,
    name: item.name,
    sortOrder: item.sortOrder,
    isActive: item.isActive,
    isLocked: item.isLocked,
    toolType: item.toolType,
    payload: item.payload,
    schemaVersion: item.schemaVersion,
  }))
}

/**
 * 全量保存 Tab 列表，返回后端写库后的结果。
 *
 * 后端会忽略传入的 id 并由 SQLite 分配真实 ID，
 * 因此调用方需要用返回值替换本地状态，避免占位 ID 残留。
 */
export async function persistTabs(tabs: WorkbenchTab[]): Promise<WorkbenchTab[]> {
  const saved = await SaveTabs(tabs.map(tab => ({
    id: tab.id,
    name: tab.name,
    sortOrder: tab.sortOrder,
    isActive: tab.isActive,
    isLocked: tab.isLocked,
    toolType: tab.toolType,
    payload: tab.payload,
    schemaVersion: tab.schemaVersion,
  })))

  return saved.map(item => ({
    id: item.id,
    name: item.name,
    sortOrder: item.sortOrder,
    isActive: item.isActive,
    isLocked: item.isLocked,
    toolType: item.toolType,
    payload: item.payload,
    schemaVersion: item.schemaVersion,
  }))
}
