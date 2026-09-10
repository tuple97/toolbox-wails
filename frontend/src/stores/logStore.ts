import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 单条日志的前缀类型 */
export type LogKind = 'request' | 'success' | 'error' | 'info'

export const useLogStore = defineStore('logs', () => {
  /** 日志行集合；每条记录可能包含多行（如请求行 + SQL 缩进） */
  const entries = ref<string[]>([])

  /** 面板是否展开 */
  const expanded = ref(true)

  /** 日志保留上限，由外部（configStore）同步 */
  const maxLines = ref(200)

  /** 追加一条日志并裁剪到上限 */
  function append(text: string) {
    entries.value.push(text)

    // 超出上限时丢弃最旧的记录
    const limit = maxLines.value
    if (entries.value.length > limit) {
      entries.value = entries.value.slice(-limit)
    }
  }

  /**
   * 记录一次请求。
   * 格式：`>> [时间] [连接名] 执行SQL:` 换行 + 缩进的 SQL
   */
  function logRequest(connName: string, sql: string) {
    const time = now()
    append(`>> [${time}] [${connName}] 执行SQL:\n${indentSql(sql)}`)
  }

  /** 记录执行成功 */
  function logSuccess(rowCount: number, elapsedMs: number) {
    append(`<< [${now()}] 成功: 共 ${rowCount} 行, 耗时 ${elapsedMs}ms`)
  }

  /** 记录执行错误 */
  function logError(message: string) {
    append(`<< [${now()}] 错误: ${message}`)
  }

  /** 记录一般信息（如渲染后的 SQL 预览） */
  function logInfo(message: string) {
    append(`-- [${now()}] ${message}`)
  }

  /** 清空日志 */
  function clear() {
    entries.value = []
  }

  /** 同步日志上限 */
  function setMaxLines(limit: number) {
    maxLines.value = limit > 0 ? limit : 200
    if (entries.value.length > maxLines.value) {
      entries.value = entries.value.slice(-maxLines.value)
    }
  }

  return {
    entries,
    expanded,
    maxLines,
    append,
    logRequest,
    logSuccess,
    logError,
    logInfo,
    clear,
    setMaxLines,
  }
})

/** 当前时间 HH:mm:ss */
function now(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 为 SQL 每行加缩进，便于在日志中区分层级 */
function indentSql(sql: string): string {
  return sql
    .split('\n')
    .map(line => `    ${line}`)
    .join('\n')
}
