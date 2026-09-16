/**
 * 列候选池（T6）：按表缓存与超宽表的前缀取舍。
 *
 * 缓存用「元数据数组引用」做键，所以断言直接比较对象引用
 * （同一份元数据 → 同一批候选项对象；元数据刷新后是新数组 → 新对象）。
 */
import { describe, expect, it } from 'vitest'
import { MAX_TABLE_COLUMNS, pooledColumnItems } from '@/utils/sql/sqlCompletionColumnPool'
import type { PoolColumn } from '@/utils/sql/sqlCompletionColumnPool'

/** 生成一段列元数据 */
function columns(names: string[]): PoolColumn[] {
  return names.map(name => ({ name, dataType: 'int', comment: '' }))
}

describe('列候选池：缓存', () => {
  it('同一份元数据只构造一次候选（引用稳定）', () => {
    const source = columns(['id', 'name'])
    const first = pooledColumnItems(source, 'users', 'mysql', '')
    const second = pooledColumnItems(source, 'users', 'mysql', '')
    expect(second).toBe(first)
    expect(first.map(item => item.label)).toEqual(['id', 'name'])
  })

  it('元数据刷新（新数组）后重新构造', () => {
    const first = pooledColumnItems(columns(['id']), 'users', 'mysql', '')
    const second = pooledColumnItems(columns(['id', 'name']), 'users', 'mysql', '')
    expect(second).not.toBe(first)
    expect(second.map(item => item.label)).toEqual(['id', 'name'])
  })

  it('来源 / 方言不同则各存一份（描述里的来源表不同）', () => {
    const source = columns(['id'])
    const byTable = pooledColumnItems(source, 'users', 'mysql', '')
    const byAlias = pooledColumnItems(source, 'u', 'mysql', '')
    const postgres = pooledColumnItems(source, 'users', 'postgres', '')

    expect(byAlias).not.toBe(byTable)
    expect(postgres).not.toBe(byTable)
    expect(byTable[0]?.columnDetail?.from).toBe('users')
    expect(byAlias[0]?.columnDetail?.from).toBe('u')
  })

  it('空元数据返回空数组', () => {
    expect(pooledColumnItems([], 'users', 'mysql', '')).toEqual([])
  })

  it('候选项自带按需引用符的插入逻辑', () => {
    const items = pooledColumnItems(columns(['order']), 'users', 'mysql', '')
    expect(items[0]?.label).toBe('order')
    expect(typeof items[0]?.apply).toBe('function')
  })
})

describe('列候选池：超宽表的取舍', () => {
  /** 500 列的宽表：头 498 列是普通名字，末尾两列分别靠前缀 / 拼音命中 */
  function wideTable(): PoolColumn[] {
    const names = Array.from({ length: 498 }, (_, index) => `c${index}`)
    return columns([...names, 'zz_target', '状态'])
  }

  it('未超限时原样返回（顺序 = 元数据顺序）', () => {
    const items = pooledColumnItems(columns(['id', 'name', 'created_at']), 'users', 'mysql', '')
    expect(items.map(item => item.label)).toEqual(['id', 'name', 'created_at'])
  })

  it('超限时截断到上限，且保留前缀命中的列', () => {
    const source = wideTable()
    const items = pooledColumnItems(source, 'users', 'mysql', 'zz')
    expect(items).toHaveLength(MAX_TABLE_COLUMNS)
    expect(items.map(item => item.label)).toContain('zz_target')
    // 前缀命中的排在最前
    expect(items[0]?.label).toBe('zz_target')
  })

  it('前缀是 ASCII 时中文列名仍然保留（拼音命中要用）', () => {
    const source = wideTable()
    const items = pooledColumnItems(source, 'users', 'mysql', 'zt')
    expect(items.map(item => item.label)).toContain('状态')
  })

  it('没有前缀时按元数据顺序截断（不做重排）', () => {
    const source = wideTable()
    const items = pooledColumnItems(source, 'users', 'mysql', '')
    expect(items).toHaveLength(MAX_TABLE_COLUMNS)
    expect(items[0]?.label).toBe('c0')
    expect(items.at(-1)?.label).toBe(`c${MAX_TABLE_COLUMNS - 1}`)
  })

  it('同一个前缀的取舍结果同样缓存', () => {
    const source = wideTable()
    const first = pooledColumnItems(source, 'users', 'mysql', 'zz')
    const second = pooledColumnItems(source, 'users', 'mysql', 'zz')
    expect(second).toBe(first)
  })
})
