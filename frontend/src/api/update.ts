/** 应用内更新 API：检查新版本 / 下载安装 / 重启生效 */
import {
  CheckUpdate,
  DownloadUpdate,
  RestartToApplyUpdate,
  UpdateState,
} from './bindings'
import { EventsOn } from './runtime'
import type { UpdateInfo } from '@/types'

/** 检查新版本；没有更新时 available 为 false */
export async function checkUpdate(): Promise<UpdateInfo> {
  const info = await CheckUpdate()
  return {
    current: String(info?.current ?? ''),
    latest: String(info?.latest ?? ''),
    available: info?.available === true,
    notes: String(info?.notes ?? ''),
    publishedAt: String(info?.publishedAt ?? ''),
    assetName: String(info?.assetName ?? ''),
    assetSize: Number(info?.assetSize ?? 0),
  }
}

/** 下载并安装更新；阶段与进度走 wails:updater:* 事件 */
export function downloadUpdate(): Promise<void> {
  return DownloadUpdate()
}

/** 重启应用以应用已下载的更新 */
export function restartToApplyUpdate(): Promise<void> {
  return RestartToApplyUpdate()
}

/** 当前更新状态（unconfigured / idle / checking / available / downloading / ready / error） */
export function updateState(): Promise<string> {
  return UpdateState()
}

/** 下载进度：percent 为 null 表示总长未知 */
export function onUpdateProgress(callback: (percent: number | null) => void): () => void {
  return EventsOn('wails:updater:download-progress', (data) => {
    const progress = data as { written?: number, total?: number } | undefined
    const total = Number(progress?.total ?? 0)
    if (total <= 0) {
      callback(null)
      return
    }
    const written = Number(progress?.written ?? 0)
    callback(Math.min(100, Math.round((written / total) * 100)))
  })
}

/** 更新出错：message 为可读原因 */
export function onUpdateError(callback: (message: string) => void): () => void {
  return EventsOn('wails:updater:error', (data) => {
    const info = data as { message?: string } | undefined
    callback(String(info?.message ?? '更新失败'))
  })
}
