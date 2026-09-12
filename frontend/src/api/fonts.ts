import { ListSystemFonts } from './bindings'

/**
 * 读取本机已安装的字体族名称。
 *
 * 后端读取 Windows 字体注册表并做去重/过滤（剔除符号字体与样式变体），
 * 结果在单次运行内缓存。任何异常都退化为空列表（界面只显示内置字体）。
 */
export async function fetchSystemFonts(): Promise<string[]> {
  try {
    const list = await ListSystemFonts()
    return Array.isArray(list) ? list : []
  }
  catch {
    return []
  }
}
