import {
  DeleteDictionary,
  ListDictionaries,
  ListDictionaryItems,
  LoadDictionaryCache,
  SaveDictionary,
  SaveDictionaryItems,
} from './bindings'
import type { Dictionary, DictionaryItem } from '@/types'

/** 把后端词典对象规整为前端类型 */
function toDictionary(raw: { id: number, name: string, description: string }): Dictionary {
  return { id: raw.id, name: raw.name, description: raw.description }
}

/** 把后端词典项规整为前端类型 */
function toDictionaryItem(raw: {
  id: number
  dictionaryId: number
  value: string
  meaning: string
  description: string
  sortOrder: number
}): DictionaryItem {
  return {
    id: raw.id,
    dictionaryId: raw.dictionaryId,
    value: raw.value,
    meaning: raw.meaning,
    description: raw.description,
    sortOrder: raw.sortOrder,
  }
}

/** 读取全部词典 */
export async function fetchDictionaries(): Promise<Dictionary[]> {
  const list = await ListDictionaries()
  return list.map(toDictionary)
}

/** 保存词典 */
export function persistDictionary(dict: Dictionary): Promise<number> {
  return SaveDictionary(dict)
}

/** 删除词典 */
export function removeDictionary(id: number): Promise<void> {
  return DeleteDictionary(id)
}

/** 读取指定词典的全部项 */
export async function fetchDictionaryItems(dictionaryId: number): Promise<DictionaryItem[]> {
  const list = await ListDictionaryItems(dictionaryId)
  return list.map(toDictionaryItem)
}

/** 全量保存词典项 */
export function persistDictionaryItems(
  dictionaryId: number,
  items: DictionaryItem[],
): Promise<void> {
  return SaveDictionaryItems(dictionaryId, items)
}

/**
 * 一次性加载全部词典与词典项。
 * 返回结构为 { 词典ID: 词典项数组 }，供前端本地翻译缓存。
 */
export async function loadDictionaryCache(): Promise<Record<number, DictionaryItem[]>> {
  const cache = await LoadDictionaryCache()
  const result: Record<number, DictionaryItem[]> = {}
  for (const [dictId, list] of Object.entries(cache ?? {})) {
    result[Number(dictId)] = (list ?? []).map(toDictionaryItem)
  }
  return result
}
