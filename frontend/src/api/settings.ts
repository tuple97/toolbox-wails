import { GetAllSettings, SaveSetting } from './bindings'
import type { Setting } from '@/types'

/** 读取全部应用配置 */
export async function fetchSettings(): Promise<Setting[]> {
  const list = await GetAllSettings()
  return list.map(item => ({
    key: item.key,
    type: item.type,
    value: item.value,
  }))
}

/** 写入单个配置项 */
export function persistSetting(key: string, value: string): Promise<void> {
  return SaveSetting(key, value)
}
