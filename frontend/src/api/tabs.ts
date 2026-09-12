import { ListTabs, SaveTabs } from './bindings'
import type { WorkbenchTab } from '@/types'

/** uid 计数器（会话内自增，不落库） */
let uidSeed = 0

/**
 * 生成 Tab 的会话内稳定标识。
 *
 * 新建标签先用负数 id 占位，首次保存时后端会重新分配 id；
 * 组件层（渲染 key、按标签的缓存）必须用 uid 才不会在保存后销毁重建。
 */
export function nextTabUid(): string {
  uidSeed += 1
  return `tab-${uidSeed}`
}

/**
 * 读取全部工作台 Tab。
 *
 * 后端返回的 database.Tab 与前端 WorkbenchTab 字段一一对应，
 * 但 Wails 生成的是 class 类型，这里显式映射保证类型安全。
 */
export async function fetchTabs(): Promise<WorkbenchTab[]> {
  const list = await ListTabs()
  return list.map(item => ({
    uid: nextTabUid(),
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
  // 发给后端的字段不含 uid：uid 是纯前端概念，不落库
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

  // 后端可能给新建标签重新分配 id，uid 必须沿用调用方的，
  // 否则组件 key 变化又会导致销毁重建（打开标签后约 1s 闪一下）
  return saved.map((item, index) => ({
    uid: tabs[index]?.uid ?? nextTabUid(),
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
