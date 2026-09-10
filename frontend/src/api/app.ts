import { GetAppInfo, Greet } from '@wails/go/app/App'
import type { app } from '@wails/go/models'

/** 后端返回的应用信息 */
export type AppInfo = app.AppInfo

/** 获取应用与运行环境信息 */
export function fetchAppInfo(): Promise<AppInfo> {
  return GetAppInfo()
}

/** 调用后端 Greet 方法 */
export function greet(name: string): Promise<string> {
  return Greet(name)
}
