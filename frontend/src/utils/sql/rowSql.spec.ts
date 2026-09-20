import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * 主键查询要走一趟数据库（information_schema），所以把执行接口换成假的：
 * 这里要验的是「问谁、什么时候不问、失败怎么办」，不是后端能不能查主键。
 */
const mocks = vi.hoisted(() => ({ executeStatement: vi.fn() }))
vi.mock('@/api/executor', () => ({ executeStatement: mocks.executeStatement }))

import {
  buildRowSqlStatement,
  dialectOf,
  kindOfMenuItem,
  parseTableRef,
  primaryKeysOfResult,
  rowSqlMenuItems,
} from '@/utils/sql/rowSql'
import type { ResultSourceContext, RowSqlContext, RowSqlTarget } from '@/utils/sql/rowSql'

/**
 * 结果行 SQL 生成的**纯函数**部分。
 *
 * 这里能覆盖的都是「不看数据库也能判定对错」的规则：
 * 转义、主键选择、以及最要紧的一条 —— 主键值缺失时必须拒绝生成，
 * 否则 WHERE 会写成 `id = NULL`（永远不成立），拿去执行等于白跑一趟。
 */
function ctxOf(overrides: Partial<RowSqlContext> = {}): RowSqlContext {
  return {
    connId: 1,
    database: 'mydb',
    dbType: 'mysql',
    sql: 'SELECT id, name FROM mydb.user',
    columns: ['id', 'name'],
    row: { id: 7, name: 'Tom' },
    ...overrides,
  }
}

function targetOf(overrides: Partial<RowSqlTarget> = {}): RowSqlTarget {
  return { dialect: 'mysql', target: '`mydb`.`user`', keys: ['id'], ...overrides }
}

describe('结果行 SQL 生成', () => {
  it('INSERT：列名与值按结果列顺序成对生成', () => {
    expect(buildRowSqlStatement('insert', ctxOf(), targetOf()))
      .toBe('INSERT INTO `mydb`.`user` (`id`, `name`) VALUES (7, \'Tom\');')
  })

  it('INSERT：缺失的字段写 NULL，字符串里的单引号按 MySQL 规则转义', () => {
    const ctx = ctxOf({ row: { id: 7, name: "O'Brien" } })
    expect(buildRowSqlStatement('insert', ctx, targetOf()))
      .toBe('INSERT INTO `mydb`.`user` (`id`, `name`) VALUES (7, \'O\'\'Brien\');')
  })

  it('UPDATE：SET 里剔除主键，WHERE 用主键等值', () => {
    expect(buildRowSqlStatement('update', ctxOf(), targetOf()))
      .toBe('UPDATE `mydb`.`user` SET `name` = \'Tom\' WHERE `id` = 7;')
  })

  it('DELETE：只带主键条件', () => {
    expect(buildRowSqlStatement('delete', ctxOf(), targetOf()))
      .toBe('DELETE FROM `mydb`.`user` WHERE `id` = 7;')
  })

  it('PostgreSQL：标识符用双引号', () => {
    const target = targetOf({ dialect: 'postgres', target: '"public"."user"' })
    expect(buildRowSqlStatement('delete', ctxOf({ dbType: 'postgres' }), target))
      .toBe('DELETE FROM "public"."user" WHERE "id" = 7;')
  })

  it('主键值缺失时拒绝生成（`id = NULL` 恒不成立，比不生成更糟）', () => {
    const ctx = ctxOf({ row: { id: null, name: 'Tom' } })
    expect(buildRowSqlStatement('delete', ctx, targetOf())).toBeNull()
    expect(buildRowSqlStatement('update', ctx, targetOf())).toBeNull()
    // 同一行的 INSERT 仍然合法：NULL 是正常的字段值
    expect(buildRowSqlStatement('insert', ctx, targetOf())).not.toBeNull()
  })

  it('复合主键：任一列缺失都不生成，齐全时逐列拼条件', () => {
    const target = targetOf({ keys: ['id', 'tenant'] })
    const complete = ctxOf({ columns: ['id', 'tenant', 'name'], row: { id: 7, tenant: 'a', name: 'Tom' } })
    expect(buildRowSqlStatement('delete', complete, target))
      .toBe('DELETE FROM `mydb`.`user` WHERE `id` = 7 AND `tenant` = \'a\';')

    const missing = ctxOf({ columns: ['id', 'tenant', 'name'], row: { id: 7, tenant: null, name: 'Tom' } })
    expect(buildRowSqlStatement('delete', missing, target)).toBeNull()
  })
})

describe('结果表格右键菜单', () => {
  it('单行：保持原来的文案', () => {
    const items = rowSqlMenuItems(1)
    expect(items[0].label).toBe('复制为…')
    expect(items[0].children?.map(item => item.label))
      .toEqual(['INSERT', 'UPDATE（按主键）', 'DELETE（按主键）'])
  })

  it('多行：标签带上行数（批量操作最怕不知道作用于几行）', () => {
    const items = rowSqlMenuItems(3)
    expect(items[0].label).toBe('批量复制为…（3 行）')
    expect(items[0].children?.map(item => item.label))
      .toEqual(['INSERT（3 行）', 'UPDATE（按主键）（3 行）', 'DELETE（按主键）（3 行）'])
  })

  it('菜单键 → 复制类型；非本菜单的键返回 null', () => {
    expect(kindOfMenuItem('copy-insert')).toBe('insert')
    expect(kindOfMenuItem('copy-update')).toBe('update')
    expect(kindOfMenuItem('copy-delete')).toBe('delete')
    expect(kindOfMenuItem('format')).toBeNull()
  })
})

describe('辅助解析', () => {
  it('方言：postgres / postgresql 都算 PostgreSQL，其余按 MySQL', () => {
    expect(dialectOf('postgres')).toBe('postgres')
    expect(dialectOf('PostgreSQL')).toBe('postgres')
    expect(dialectOf('mysql')).toBe('mysql')
    expect(dialectOf('')).toBe('mysql')
  })

  it('表名解析：限定名带上库 / 模式，未限定时只给表名', () => {
    expect(parseTableRef('SELECT * FROM `mydb`.`user`')).toEqual({ schema: 'mydb', table: 'user' })
    expect(parseTableRef('select * from user')).toEqual({ schema: '', table: 'user' })
    expect(parseTableRef('DELETE FROM "public"."log"')).toEqual({ schema: 'public', table: 'log' })
  })
})

describe('结果集主键（表头标识用）', () => {
  /** 查主键用的来源上下文；表名各不相同 —— 主键结果有模块级缓存，同名会互相干扰 */
  function sourceOf(sql: string, overrides: Partial<ResultSourceContext> = {}): ResultSourceContext {
    return { connId: 1, database: 'mydb', dbType: 'mysql', sql, ...overrides }
  }

  beforeEach(() => {
    mocks.executeStatement.mockReset()
  })

  it('识别得出表时，返回 information_schema 查到的列名', async () => {
    mocks.executeStatement.mockResolvedValue({ rows: [{ name: 'id' }] })
    await expect(primaryKeysOfResult(sourceOf('SELECT * FROM pk_basic_users')))
      .resolves.toEqual(['id'])
    // 查的是这张表（库名来自上下文）
    const [request] = mocks.executeStatement.mock.calls[0]
    expect(request.sql).toContain("tc.table_name = 'pk_basic_users'")
    expect(request.sql).toContain("tc.table_schema = 'mydb'")
  })

  it('复合主键按 ordinal 顺序原样返回（顺序有用：WHERE 条件按它拼）', async () => {
    mocks.executeStatement.mockResolvedValue({ rows: [{ name: 'tenant' }, { name: 'id' }] })
    await expect(primaryKeysOfResult(sourceOf('SELECT * FROM pk_composite')))
      .resolves.toEqual(['tenant', 'id'])
  })

  it('没有连接时不查库（表头不加标识，不打扰用户）', async () => {
    await expect(primaryKeysOfResult(sourceOf('SELECT * FROM whatever', { connId: null })))
      .resolves.toEqual([])
    expect(mocks.executeStatement).not.toHaveBeenCalled()
  })

  it('SQL 里识别不出表时不查库（函数 / 复杂子查询的结果）', async () => {
    await expect(primaryKeysOfResult(sourceOf('SELECT 1')))
      .resolves.toEqual([])
    await expect(primaryKeysOfResult(sourceOf('SELECT * FROM (SELECT 1) t')))
      .resolves.toEqual([])
    expect(mocks.executeStatement).not.toHaveBeenCalled()
  })

  it('查询失败时安静返回空集 —— 主键标识是装饰，不该弹错打断看数据', async () => {
    mocks.executeStatement.mockRejectedValue(new Error('permission denied'))
    await expect(primaryKeysOfResult(sourceOf('SELECT * FROM pk_denied')))
      .resolves.toEqual([])
  })

  it('同一张表重复问只查一次（翻页 / 重渲染不会反复打库）', async () => {
    mocks.executeStatement.mockResolvedValue({ rows: [{ name: 'id' }] })
    const source = sourceOf('SELECT * FROM pk_cached_users')
    await primaryKeysOfResult(source)
    await primaryKeysOfResult(source)
    expect(mocks.executeStatement).toHaveBeenCalledTimes(1)
  })
})
