/**
 * 剪贴板工具。
 *
 * 优先用 Wails 原生能力（`@wailsio/runtime` 的 Clipboard），
 * 失败或不可用时退回浏览器剪贴板。抽成公共模块是因为「复制」在执行记录、
 * 结果行 SQL 生成等多处都要用，避免各写一份、行为不一致。
 */
import { Clipboard } from '@wailsio/runtime'

/** 写入剪贴板；两条路径都不可用时抛错（由调用方提示） */
export async function copyText(text: string): Promise<void> {
  try {
    if (Clipboard?.SetText) {
      await Clipboard.SetText(text)
      return
    }
  }
  catch {
    // 落到浏览器剪贴板
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  throw new Error('当前环境不支持写入剪贴板')
}
