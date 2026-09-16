/**
 * 混合语言光标分析用例。
 *
 * 关键点：语言区域是**结构判定**（`{{ … }}` 是内嵌语言），
 * 所以写在 SQL 字符串里的插值归模板管；而纯 SQL 编辑器里 `{{` 只是普通字符。
 */
import { EditorState } from '@codemirror/state'
import { MySQL, sql } from '@codemirror/lang-sql'
import { describe, expect, it } from 'vitest'
import { analyzeHybridCursor } from '@/utils/sql/hybridCursor'

const MARK = '§'

/** 分析 `§` 处（编辑器内容里的 `§` 会被移除） */
function analyzeAt(docWithCursor: string, mode: 'sql' | 'sql-template' | 'javascript' | 'none') {
  const pos = docWithCursor.indexOf(MARK)
  const doc = docWithCursor.replace(MARK, '')
  const state = EditorState.create({ doc, extensions: [sql({ dialect: MySQL })] })
  return analyzeHybridCursor(state, pos, { mode })
}

describe('语言区域判定', () => {
  it('SQL 主体归 SQL', () => {
    const cursor = analyzeAt('SELECT u.§ FROM users u', 'sql')
    expect(cursor.language).toBe('sql')
    expect(cursor.prefix).toBe('')
    expect(cursor.qualifier).toBe('u.')
  })

  it('未闭合的模板片段归模板', () => {
    const cursor = analyzeAt('SELECT * FROM users WHERE name = {{ dev§', 'sql-template')
    expect(cursor.language).toBe('template')
    expect(cursor.prefix).toBe('dev')
    // `{{` 之前是 33 个字符（`SELECT * FROM users WHERE name = `）
    expect(cursor.templateRegion?.openAt).toBe(33)
  })

  it('字符串里的插值同样归模板（区域优先于字符串判定）', () => {
    const cursor = analyzeAt("WHERE name = '{{ dev§ }}'", 'sql-template')
    expect(cursor.language).toBe('template')
    expect(cursor.inLiteral).toBe(false)
  })

  it('注释里的插值也归模板', () => {
    const cursor = analyzeAt('-- {{ dev§ }}', 'sql-template')
    expect(cursor.language).toBe('template')
  })

  it('没有模板片段的字符串 / 注释拦下补全', () => {
    expect(analyzeAt("WHERE name = 'abc§'", 'sql-template').language).toBe('blocked')
    expect(analyzeAt('SELECT 1 -- 写点什么§', 'sql').language).toBe('blocked')
  })

  it('已闭合的模板片段之后回到 SQL', () => {
    const cursor = analyzeAt('WHERE name = {{ device_no }}§ AND 1 = 1', 'sql-template')
    expect(cursor.language).toBe('sql')
  })

  it('纯 SQL 编辑器里 {{ 只是普通字符', () => {
    const cursor = analyzeAt('SELECT {{ dev§', 'sql')
    expect(cursor.language).toBe('sql')
  })

  it('脚本与不补全的编辑器各有归属', () => {
    expect(analyzeAt('rows§', 'javascript').language).toBe('script')
    expect(analyzeAt('rows§', 'none').language).toBe('none')
  })
})

describe('替换范围', () => {
  it('词范围 + 点号限定符构成最终替换范围', () => {
    const cursor = analyzeAt('SELECT u.na§me FROM users u', 'sql')
    expect(cursor.wordRange).toEqual({ from: 9, to: 13 })
    expect(cursor.range).toEqual({ from: 7, to: 13 })
    expect(cursor.qualifier).toBe('u.')
  })

  it('模板里只算词，不带点号限定符', () => {
    const cursor = analyzeAt('{{ device_n§ }}', 'sql-template')
    expect(cursor.range).toEqual({ from: 3, to: 11 })
    expect(cursor.qualifier).toBe('')
  })
})
