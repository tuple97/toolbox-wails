/**
 * 候选生成层用例：确认它是「吃语义对象 + 依赖」的纯函数层。
 *
 * 位置标记用 `§`。
 */
import { EditorState } from '@codemirror/state'
import { MySQL, sql } from '@codemirror/lang-sql'
import { describe, expect, it } from 'vitest'
import { analyzeSqlCursorText } from '@/utils/sql/sqlCursor'
import type { MetadataProvider } from '@/utils/sql/sqlCompletion'
import type { TableRef } from '@/utils/sql/sqlSchema'
import {
  columnsOfRef,
  generalSuggestions,
  joinConditionSuggestions,
  resolveAfterDot,
  staticOptions,
} from '@/utils/sql/sqlSuggestions'
import type { SqlSuggestDeps } from '@/utils/sql/sqlSuggestions'

const MARK = '§'

/** 静态元数据：testdb 下 users(id, name)、orders(id, user_id) */
const metadata: MetadataProvider = {
  databases: () => ['testdb'],
  tables: (_connId, database) => (database === 'testdb' ? ['users', 'orders'] : []),
  columns: (_connId, _database, table) => {
    if (table === 'users') {
      return [
        { name: 'id', dataType: 'int', comment: '' },
        { name: 'name', dataType: 'varchar', comment: '名称' },
      ]
    }
    if (table === 'orders') {
      return [
        { name: 'id', dataType: 'int', comment: '' },
        { name: 'user_id', dataType: 'int', comment: '用户' },
      ]
    }
    return []
  },
  foreignKeys: (_connId, _database, table) => (table === 'orders'
    ? [{ column: 'user_id', referencedTable: 'users', referencedColumn: 'id' }]
    : []),
}

const deps: SqlSuggestDeps = { connId: 1, database: 'testdb', dialect: 'mysql', metadata }

/** 光标语义（用真实的分析器构造） */
function intentOf(docWithCursor: string) {
  const pos = docWithCursor.indexOf(MARK)
  const doc = docWithCursor.replace(MARK, '')
  const state = EditorState.create({ doc, extensions: [sql({ dialect: MySQL })] })
  return analyzeSqlCursorText(state, pos, 'mysql')
}

/** users u 的作用域 */
const usersScope: TableRef[][] = [[{ schema: '', table: 'users', alias: 'u' }]]

describe('staticOptions', () => {
  it('给关键字与函数', () => {
    const labels = staticOptions().map(item => item.label)
    expect(labels).toContain('SELECT')
    expect(labels).toContain('COUNT')
  })

  it('可以关掉函数候选（轻量场景）', () => {
    const labels = staticOptions({ disableFunctions: true }).map(item => item.label)
    expect(labels).toContain('SELECT')
    expect(labels).not.toContain('COUNT')
  })
})

describe('generalSuggestions', () => {
  it('表达式位置：给出列与别名', () => {
    const items = generalSuggestions({
      intent: intentOf('SELECT § FROM users u'),
      scopes: usersScope,
      deps,
    })
    const labels = items.map(item => item.label)
    expect(labels).toContain('name')
    expect(labels).toContain('u')
  })

  it('别名位置什么都不给', () => {
    const items = generalSuggestions({
      intent: intentOf('SELECT * FROM users AS §'),
      scopes: usersScope,
      deps,
    })
    expect(items).toEqual([])
  })

  it('表名位置只给表与库（不给列）', () => {
    const labels = generalSuggestions({
      intent: intentOf('SELECT * FROM §'),
      scopes: [],
      deps,
    }).map(item => item.label)
    expect(labels).toContain('users')
    expect(labels).toContain('testdb')
    expect(labels).not.toContain('name')
  })

  it('跳过的列不再重复出现（GROUP BY 推荐去重）', () => {
    const labels = generalSuggestions({
      intent: intentOf('SELECT * FROM users u GROUP BY §'),
      scopes: usersScope,
      deps,
      skipColumns: new Set(['name']),
    }).map(item => item.label)
    expect(labels).not.toContain('name')
    expect(labels).toContain('id')
  })
})

describe('resolveAfterDot', () => {
  it('别名命中该表的字段', () => {
    const labels = resolveAfterDot(['u'], usersScope, deps).map(item => item.label)
    expect(labels).toContain('name')
  })

  it('库里已知的表名给该表字段', () => {
    const labels = resolveAfterDot(['users'], [], deps).map(item => item.label)
    expect(labels).toContain('name')
  })
})

describe('columnsOfRef', () => {
  it('派生表用静态解析出的列，不查元数据', () => {
    const ref: TableRef = {
      schema: '',
      table: 't1',
      alias: 't1',
      virtualColumns: [{ name: 'x', from: 'users', dataType: 'int' }],
    }
    expect(columnsOfRef(ref, deps).map(column => column.name)).toEqual(['x'])
  })

  it('物理表查元数据', () => {
    const ref: TableRef = { schema: '', table: 'users', alias: 'u' }
    expect(columnsOfRef(ref, deps).map(column => column.name)).toEqual(['id', 'name'])
  })
})

describe('joinConditionSuggestions', () => {
  it('两表之间给关联条件（外键优先）', () => {
    const scopes: TableRef[][] = [[
      { schema: '', table: 'users', alias: 'u' },
      { schema: '', table: 'orders', alias: 'o' },
    ]]
    const items = joinConditionSuggestions(scopes, deps)
    expect(items.length).toBeGreaterThan(0)
    expect(items.some(item => String(item.apply).includes('user_id'))).toBe(true)
  })

  it('只有一张表时不给（没得关联）', () => {
    expect(joinConditionSuggestions(usersScope, deps)).toEqual([])
  })
})
