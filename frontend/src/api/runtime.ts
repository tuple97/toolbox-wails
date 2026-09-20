/** Wails v3 事件封装，回调签名统一为 callback(data) */

import { Events } from '@wailsio/runtime'

/** 监听 Wails 事件，返回取消监听的函数 */
export function EventsOn(
  eventName: string,
  callback: (data?: unknown) => void,
): () => void {
  return Events.On(eventName, (event) => {
    callback(event?.data)
  })
}

export function EventsOnce(
  eventName: string,
  callback: (data?: unknown) => void,
): () => void {
  return Events.Once(eventName, (event) => {
    callback(event?.data)
  })
}

export function EventsEmit(eventName: string, data?: unknown): void {
  void Events.Emit(eventName, data)
}

export function EventsOff(...eventNames: string[]): void {
  Events.Off(...(eventNames as [string, ...string[]]))
}
