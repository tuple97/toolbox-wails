/**
 * 应用与系统信息 API。
 *
 * - GetAppInfo：应用版本 / 运行环境（状态栏展示版本号用）；
 * - GetSystemMetrics：实时资源采样（首页监控卡片轮询用，后端采样含 200ms CPU 窗口）。
 */
import { GetAppInfo, GetSystemMetrics } from './bindings'

/** 应用与运行环境信息（映射自后端 AppInfo） */
export interface AppInfo {
  name: string
  version: string
  goVersion: string
  platform: string
  arch: string
}

/** 一次系统与应用资源采样（映射自后端 SystemMetrics） */
export interface SystemMetrics {
  /** 应用自身内存占用（MB） */
  appMemoryMB: number
  /** 物理内存总量（MB） */
  memoryTotalMB: number
  /** 已用物理内存（MB） */
  memoryUsedMB: number
  /** 内存使用率（0~100） */
  memoryPercent: number
  /** 全系统 CPU 使用率（0~100） */
  cpuPercent: number
  /** 逻辑核心数 */
  cpuCount: number
  /** 采样时刻（Unix 毫秒） */
  timestamp: number
}

/** 应用信息；失败时返回空对象，调用方自己决定回退展示 */
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

/** 采集一次系统指标；失败时返回 null（首页显示占位，不弹错误） */
export async function fetchSystemMetrics(): Promise<SystemMetrics | null> {
  try {
    const metrics = await GetSystemMetrics()
    if (!metrics) {
      return null
    }
    return {
      appMemoryMB: Number(metrics.appMemoryMB ?? 0),
      memoryTotalMB: Number(metrics.memoryTotalMB ?? 0),
      memoryUsedMB: Number(metrics.memoryUsedMB ?? 0),
      memoryPercent: Number(metrics.memoryPercent ?? 0),
      cpuPercent: Number(metrics.cpuPercent ?? 0),
      cpuCount: Number(metrics.cpuCount ?? 0),
      timestamp: Number(metrics.timestamp ?? 0),
    }
  }
  catch {
    return null
  }
}
