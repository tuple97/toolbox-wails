/**
 * 连接的展示辅助：环境标识与下拉选项文本。
 *
 * 环境标识（本地 / 测试 / 生产）在数据层是互斥的，这里统一按
 * 「生产 > 测试 > 本地」取第一个命中的，保证列表与下拉不出现多个环境标签。
 * 展示规则集中在此处，避免各处下拉各写一套、样式与文案漂移。
 */
import type { DBConnection } from '@/types'

/** 环境标签的展示信息 */
export interface ConnectionEnvBadge {
  /** 标签文案 */
  text: string
  /** Element Plus tag 类型 */
  type: 'success' | 'warning' | 'danger'
}

/** 取连接的环境标签；未标记时返回 null */
export function connectionEnvBadge(conn: DBConnection): ConnectionEnvBadge | null {
  if (conn.isProduction) {
    return { text: '生产', type: 'danger' }
  }
  if (conn.isTest) {
    return { text: '测试', type: 'warning' }
  }
  if (conn.isLocal) {
    return { text: '本地', type: 'success' }
  }
  return null
}

/**
 * 下拉选项的 label（同时也是选中后输入框显示的文本）。
 *
 * 带上环境与只读标记，选中生产库时在输入框里也能一眼看到；
 * 保留 dbType 是为了让 filterable 的搜索仍能按数据库类型匹配。
 */
export function connectionOptionLabel(conn: DBConnection): string {
  const marks = [connectionEnvBadge(conn)?.text, conn.readOnly ? '只读' : ''].filter(Boolean)
  return `${conn.name}${marks.length ? ` · ${marks.join(' · ')}` : ''} (${conn.dbType})`
}
