/**
 * 应用内提示（替代 Element Plus 的 `ElMessage`）。
 *
 * 与 EP 的差别：不再是「命令式调用直接往 DOM 里插节点」，而是
 * **一个响应式队列 + 一个宿主组件**（`components/ui/Toaster.vue`，挂在 App.vue）。
 * 好处是提示成了普通状态：样式全归自己管、能被用例断言（`activeNotices()`）、
 * 也不会在应用卸载后留下孤儿节点。
 *
 * 用法与旧代码一致，迁移时只是把 `ElMessage` 换成 `notify`：
 *   `ElMessage.success('已保存')` → `notify.success('已保存')`
 */
import { readonly, ref } from 'vue'

export type NoticeTone = 'success' | 'error' | 'warning' | 'info'

export interface Notice {
  id: number
  tone: NoticeTone
  /** 正文（整句，由调用方拼好 —— 与旧 ElMessage 的用法一致） */
  message: string
}

/** 停留时长：与旧 ElMessage 的默认值一致 */
const NOTICE_DURATION_MS = 3000
/** 最多同时显示几条：超出丢掉最旧的，避免连环报错时刷满屏幕 */
const MAX_VISIBLE = 4

const notices = ref<Notice[]>([])
let seq = 0

function push(tone: NoticeTone, message: string): number {
  const id = ++seq
  // 拷贝而不是原地 push：读方（组件 / 用例）拿到的永远是新数组，触发更可预期
  notices.value = [...notices.value, { id, tone, message }].slice(-MAX_VISIBLE)
  setTimeout(() => dismiss(id), NOTICE_DURATION_MS)
  return id
}

/** 关掉某条提示（到时间自动触发，也可由关闭按钮触发） */
export function dismiss(id: number) {
  notices.value = notices.value.filter(notice => notice.id !== id)
}

/** 当前提示列表（宿主组件消费；用例也用它断言） */
export const activeNotices = readonly(notices)

/** 与旧 `ElMessage` 同形的四个入口 */
export const notify = {
  success: (message: string) => push('success', message),
  error: (message: string) => push('error', message),
  warning: (message: string) => push('warning', message),
  info: (message: string) => push('info', message),
}
