/**
 * Wails v3 事件封装。
 *
 * v3 变更（相对 v2）：
 *  - runtime 改为 npm 包 `@wailsio/runtime`（导入即激活拖动/右键菜单等副作用），
 *    不再需要 index.html 里加载 /wails/runtime.js。
 *  - 事件回调收到的是 `WailsEvent` 对象，数据在 `ev.data` 中；
 *    v2 是直接把数据作为回调参数。
 *
 * 本封装把回调签名统一为 `callback(data)`，调用方无需关心差异。
 */

import { Events } from '@wailsio/runtime'

/**
 * 监听 Wails 事件，返回取消监听的函数。
 *
 * 回调参数为事件数据本体（即 v3 WailsEvent.data），
 * 未携带数据时传入 undefined。
 */
export function EventsOn(
  eventName: string,
  callback: (data?: unknown) => void,
): () => void {
  return Events.On(eventName, (event) => {
    callback(event?.data)
  })
}

/**
 * 只监听一次。
 */
export function EventsOnce(
  eventName: string,
  callback: (data?: unknown) => void,
): () => void {
  return Events.Once(eventName, (event) => {
    callback(event?.data)
  })
}

/** 向后端发送事件 */
export function EventsEmit(eventName: string, data?: unknown): void {
  void Events.Emit(eventName, data)
}

/** 移除指定事件的全部监听 */
export function EventsOff(...eventNames: string[]): void {
  Events.Off(...(eventNames as [string, ...string[]]))
}
