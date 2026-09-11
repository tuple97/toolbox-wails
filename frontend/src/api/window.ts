/**
 * 窗口控制封装。
 *
 * 说明：项目 tsconfig 的 include 只匹配 `wailsjs/**\/*.ts`，而 runtime 的实现是
 * JS + 独立 `.d.ts`，类型并不会被 TS 解析到；因此这里显式声明所需签名，
 * 避免依赖隐式 any，同时保证工具栏在浏览器调试（无 Wails 运行时）下不报错。
 */

import {
  WindowClose,
  WindowIsMaximised,
  WindowMinimise,
  WindowToggleMaximise,
} from './bindings'

/** 是否运行在 Wails 桌面环境中（浏览器直接访问 dev server 时为 false） */
export const isWailsRuntime = typeof window !== 'undefined' && 'runtime' in window

/** 最小化窗口 */
export function minimiseWindow(): void {
  void WindowMinimise()
}

/** 关闭窗口 */
export function closeWindow(): void {
  void WindowClose()
}

/** 在最大化与还原之间切换 */
export function toggleMaximiseWindow(): void {
  void WindowToggleMaximise()
}

/** 查询窗口是否处于最大化状态 */
export async function isWindowMaximised(): Promise<boolean> {
  return await WindowIsMaximised()
}
