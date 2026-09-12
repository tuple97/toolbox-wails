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
import { Window } from '@wailsio/runtime'
import type { ThemeMode } from '@/types'

/** 主题对应的窗口底色，与 styles/global.css 的 --bg-color 保持一致 */
const WINDOW_BG_COLORS: Record<ThemeMode, readonly [number, number, number]> = {
  dark: [15, 23, 42], // #0f172a
  midnight: [10, 10, 12], // #0a0a0c
  idea: [43, 43, 43], // #2b2b2b
  light: [241, 245, 249], // #f1f5f9
}

/** 是否运行在 Wails 桌面环境中（浏览器直接访问 dev server 时为 false） */
export const isWailsRuntime = typeof window !== 'undefined' && 'runtime' in window

/**
 * 让窗口底色跟随主题。
 *
 * 窗口重绘（如新建/切换窗口、缩放）时会先擦出窗口底色，
 * 底色与页面背景不一致就会出现「闪黑 / 闪白」一下。
 */
export function syncWindowBackground(theme: ThemeMode): void {
  const [r, g, b] = WINDOW_BG_COLORS[theme]
  void Window.SetBackgroundColour(r, g, b, 255)
}

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
