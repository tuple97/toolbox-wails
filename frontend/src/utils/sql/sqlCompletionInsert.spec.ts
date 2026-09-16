/**
 * 插入核对（T6）：标识符引用符与右引号补齐。
 *
 * 用假 view 接住 dispatch 的 changes，逐条核对「选中候选项后文档变成什么」——
 * 这类问题（少引号导致 SQL 跑不通、多引号导致 `` ``users` ``）只有看到最终文本才能确认。
 */
import { describe, expect, it } from 'vitest'
import type { Completion } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import {
  columnItem,
  needsQuoting,
  openingQuoteBefore,
  quotedIdentApply,
  renderIdent,
  toggleColumnMark,
} from '@/utils/sql/sqlCompletionInsert'

/**
 * 假编辑器：只实现插入逻辑用到的那几件事。
 *
 * - `state.doc.toString()`：读文档（限定符 / 开引号判断要用）
 * - `dispatch`：把 changes 记下来
 * - 勾选状态走 WeakMap，用同一个假 view 对象即可
 */
function fakeView(doc: string) {
  const changes: Array<{ from: number, to: number, insert: string }> = []
  const view = {
    state: { doc: { toString: () => doc } },
    dispatch: (spec: { changes: { from: number, to: number, insert: string } }) => {
      changes.push(spec.changes)
    },
  } as unknown as EditorView
  return { view, changes }
}

/** 光标前正在输入的词的首字符下标（编辑器给补全的替换起点就是它） */
function wordStart(doc: string): number {
  const word = /[A-Za-z0-9_$]*$/.exec(doc)?.[0] ?? ''
  return doc.length - word.length
}

/** 应用一个候选项，返回它实际写入的文本与替换范围 */
function applyColumn(
  doc: string,
  item: Completion,
  marked: string[] = [],
): { from: number, to: number, insert: string } | null {
  const { view, changes } = fakeView(doc)
  for (const label of marked) {
    toggleColumnMark(view, label)
  }
  const apply = item.apply
  if (typeof apply !== 'function') {
    return null
  }
  apply(view, item, wordStart(doc), doc.length)
  return changes[0] ?? null
}

describe('标识符引用符：判定', () => {
  it('普通标识符不加引号', () => {
    expect(needsQuoting('name')).toBe(false)
    expect(needsQuoting('user_id')).toBe(false)
    expect(needsQuoting('_tmp1')).toBe(false)
  })

  it('保留字要加引号（列名里最常踩到的那些）', () => {
    expect(needsQuoting('order')).toBe(true)
    expect(needsQuoting('key')).toBe(true)
    expect(needsQuoting('user')).toBe(true)
    expect(needsQuoting('desc')).toBe(true)
    expect(needsQuoting('rank')).toBe(true)
  })

  it('常见但非保留的词不加引号（避免日常列名被包起来）', () => {
    expect(needsQuoting('status')).toBe(false)
    expect(needsQuoting('type')).toBe(false)
    expect(needsQuoting('password')).toBe(false)
  })

  it('含特殊字符或中文的名字要加引号', () => {
    expect(needsQuoting('user name')).toBe(true)
    expect(needsQuoting('user-name')).toBe(true)
    expect(needsQuoting('名称')).toBe(true)
    expect(needsQuoting('1st')).toBe(true)
  })
})

describe('标识符引用符：落地写法', () => {
  it('按需加引号，方言决定引号字符', () => {
    expect(renderIdent('name', 'mysql')).toBe('name')
    expect(renderIdent('order', 'mysql')).toBe('`order`')
    expect(renderIdent('order', 'postgres')).toBe('"order"')
    expect(renderIdent('user name', 'postgres')).toBe('"user name"')
  })

  it('用户已经敲了引号就沿用他的样式并配对着闭合', () => {
    expect(renderIdent('name', 'mysql', '`')).toBe('`name`')
    expect(renderIdent('name', 'mysql', '"')).toBe('"name"')
    expect(renderIdent('name', 'mysql', '[')).toBe('[name]')
  })

  it('名字里含引号时双写转义', () => {
    expect(renderIdent('a`b', 'mysql', '`')).toBe('`a``b`')
  })
})

describe('右引号补齐：开引号识别', () => {
  it('光标前的开引号会被识别（含位置）', () => {
    const doc = 'SELECT `na'
    expect(openingQuoteBefore(doc, wordStart(doc)))
      .toEqual({ quote: '`', close: '`', start: 7 })

    const withDouble = 'SELECT "na'
    expect(openingQuoteBefore(withDouble, wordStart(withDouble))?.quote).toBe('"')

    const withBracket = 'SELECT [na'
    expect(openingQuoteBefore(withBracket, wordStart(withBracket))?.close).toBe(']')
  })

  it('闭引号不算开引号（`` `name` `` 的第二个）', () => {
    const doc = 'SELECT `name`'
    expect(openingQuoteBefore(doc, wordStart(doc))).toBeNull()
  })

  it('没有引号时返回 null', () => {
    const doc = 'SELECT na'
    expect(openingQuoteBefore(doc, wordStart(doc))).toBeNull()
    expect(openingQuoteBefore('', 0)).toBeNull()
  })
})

describe('列插入：最终写进文档的文本', () => {
  it('普通列名不加引号', () => {
    const item = columnItem('name', {}, 'mysql')
    expect(applyColumn('SELECT ', item)).toEqual({ from: 7, to: 7, insert: 'name' })
  })

  it('保留字列名自动加引用符（不然 SQL 直接语法错误）', () => {
    const mysql = columnItem('order', {}, 'mysql')
    expect(applyColumn('SELECT ', mysql)?.insert).toBe('`order`')

    const postgres = columnItem('order', {}, 'postgres')
    expect(applyColumn('SELECT ', postgres)?.insert).toBe('"order"')
  })

  it('用户敲了开引号：把引号纳入替换并补上右引号', () => {
    const doc = 'SELECT `na'
    const item = columnItem('name', {}, 'mysql')
    // 替换范围从左引号开始（第 7 位），插入闭合的 `name`
    expect(applyColumn(doc, item)).toEqual({ from: 7, to: 10, insert: '`name`' })
  })

  it('点号补全 + 开引号：限定符保留在引号左边', () => {
    const doc = 'SELECT u.`na'
    const item = columnItem('name', {}, 'mysql')
    // 从别名 u 开始替换，插入 u.`name`
    expect(applyColumn(doc, item)).toEqual({ from: 7, to: 12, insert: 'u.`name`' })
  })

  it('勾选多列时每一列都独立处理引用符', () => {
    const doc = 'SELECT `n'
    const item = columnItem('name', {}, 'mysql')
    const change = applyColumn(doc, item, ['name', 'order'])
    expect(change).toEqual({ from: 7, to: 9, insert: '`name`, `order`' })
  })

  it('普通列多选只在一处加引号（各自按需）', () => {
    const doc = 'SELECT na'
    const item = columnItem('name', {}, 'mysql')
    const change = applyColumn(doc, item, ['name', 'order'])
    expect(change?.insert).toBe('name, `order`')
  })
})

describe('表候选：吃掉用户已经敲下的开引号', () => {
  it('已敲开引号时不会出现两个引号', () => {
    const doc = 'SELECT * FROM `us'
    const { view, changes } = fakeView(doc)
    quotedIdentApply('`users`')(view, {} as Completion, wordStart(doc), doc.length)
    expect(changes[0]).toEqual({ from: 14, to: 17, insert: '`users`' })
  })

  it('没敲引号时就是普通替换', () => {
    const doc = 'SELECT * FROM us'
    const { view, changes } = fakeView(doc)
    quotedIdentApply('`users`')(view, {} as Completion, wordStart(doc), doc.length)
    expect(changes[0]).toEqual({ from: 14, to: 16, insert: '`users`' })
  })
})
