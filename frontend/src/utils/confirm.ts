/**
 * 确认对话框（替代 Element Plus 的 `ElMessageBox.confirm`）。
 *
 * 只保留应用真正需要的一档：一句正文 + 标题 + 确定/取消，**返回 boolean**。
 *
 * 旧写法是
 *   `try { await ElMessageBox.confirm(...) ; 干活 } catch { /* 取消 *​/ }`
 * —— 取消靠抛异常表达，和真实错误混在同一条 catch 里，容易把「取消」写成「静默失败」。
 * 这里改成返回值：
 *   `if (!(await askConfirm({ ... }))) { return }`
 * 取消是正常分支，异常才是异常。
 */
import { readonly, ref } from 'vue'

export interface ConfirmOptions {
  /** 正文：说清「会发生什么」，不要只写「确定吗」 */
  message: string
  title?: string
  confirmText?: string
  cancelText?: string
  /** 语气：不可撤销的操作用 danger（确认按钮走危险色） */
  tone?: 'warning' | 'danger'
}

/** 待确认请求（宿主组件 `ConfirmHost.vue` 消费） */
export interface PendingConfirm {
  /** 本次请求的序号：旧请求的回调不会落到新请求上 */
  id: number
  title: string
  message: string
  confirmText: string
  cancelText: string
  tone: 'warning' | 'danger'
}

const pending = ref<PendingConfirm | null>(null)
let resolver: ((ok: boolean) => void) | null = null
let seq = 0

/** 当前待确认的请求（无则 null） */
export const pendingConfirm = readonly(pending)

/**
 * 弹一个确认框。
 *
 * 确定 → `true`；取消 / Esc / 点遮罩 → `false`。
 * 同一时刻只留一个：新请求顶掉旧请求，旧的那个按「取消」结算，
 * 避免出现「Promise 永远悬着」的调用方。
 */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  resolver?.(false)
  seq += 1
  pending.value = {
    id: seq,
    title: options.title ?? '请确认',
    message: options.message,
    confirmText: options.confirmText ?? '确定',
    cancelText: options.cancelText ?? '取消',
    tone: options.tone ?? 'warning',
  }
  return new Promise<boolean>((resolve) => {
    resolver = resolve
  })
}

/** 宿主组件结算当前请求（确定 / 取消都走这里） */
export function settleConfirm(ok: boolean) {
  const resolve = resolver
  resolver = null
  pending.value = null
  resolve?.(ok)
}
