/**
 * Wails runtime 事件封装。
 *
 * 说明：项目 tsconfig 的 include 未覆盖 wailsjs/runtime 的 .d.ts，
 * 因此这里声明所需签名，避免依赖隐式 any。
 */

interface WailsRuntime {
  EventsOnMultiple?: (eventName: string, callback: (...data: unknown[]) => void, max: number) => () => void
  EventsOff?: (eventName: string, ...rest: string[]) => void
}

function getRuntime(): WailsRuntime | null {
  if (typeof window === 'undefined') {
    return null
  }
  const runtime = (window as unknown as { runtime?: WailsRuntime }).runtime
  return runtime ?? null
}

/**
 * 监听 Wails 事件，返回取消监听的函数。
 * 非 Wails 环境（浏览器调试）下返回空函数，保证调用方无需判空。
 */
export function EventsOn(
  eventName: string,
  callback: (...data: unknown[]) => void,
): () => void {
  const runtime = getRuntime()
  if (!runtime?.EventsOnMultiple) {
    return () => {}
  }

  const off = runtime.EventsOnMultiple(eventName, callback, -1)
  return () => {
    // 优先使用返回的取消函数，兼容不同版本
    if (typeof off === 'function') {
      off()
      return
    }
    runtime.EventsOff?.(eventName)
  }
}
