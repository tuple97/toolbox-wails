/** 应用更新流程：检查 → 询问 → 下载 → 提示重启 */
import { checkUpdate, downloadUpdate, restartToApplyUpdate } from '@/api/update'
import { useConfigStore } from '@/stores/configStore'
import { askConfirm } from '@/utils/confirm'
import { notify } from '@/utils/notify'

/** 启动时按设置自动检查：有新版本就问一次；检查失败静默，不打扰使用 */
export async function autoCheckUpdateOnStartup(): Promise<void> {
  if (useConfigStore().values.app_auto_update !== 'true') {
    return
  }

  let info
  try {
    info = await checkUpdate()
  }
  catch {
    return
  }
  if (!info.available) {
    return
  }

  const confirmed = await askConfirm({
    title: '发现新版本',
    message: `v${info.latest} 已发布，是否现在更新？`,
    confirmText: '立即更新',
  })
  if (confirmed) {
    await installUpdate()
  }
}

/** 下载并安装更新，完成后询问是否重启 */
export async function installUpdate(): Promise<void> {
  notify.info('正在下载更新…')
  try {
    await downloadUpdate()
  }
  catch (e) {
    notify.error(e instanceof Error ? e.message : String(e))
    return
  }

  notify.success('更新已下载完成')
  const confirmed = await askConfirm({
    title: '更新已就绪',
    message: '重启应用即可完成更新，现在重启？',
    confirmText: '立即重启',
  })
  if (confirmed) {
    await restartToApplyUpdate()
  }
}
