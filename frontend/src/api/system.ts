/** 应用与运行环境信息 API */
import { GetAppInfo } from './bindings'

export interface AppInfo {
  name: string
  version: string
  goVersion: string
  platform: string
  arch: string
}

/** 读取应用信息，失败时返回空对象 */
export async function fetchAppInfo(): Promise<Partial<AppInfo>> {
  try {
    const info = await GetAppInfo()
    return {
      name: String(info?.name ?? ''),
      version: String(info?.version ?? ''),
      goVersion: String(info?.goVersion ?? ''),
      platform: String(info?.platform ?? ''),
      arch: String(info?.arch ?? ''),
    }
  }
  catch {
    return {}
  }
}
