/**
 * 字体选项。
 *
 * 设计：只内置一个默认字体 Nunito（随应用打包，离线可用），
 * 其余选项来自**本机已安装字体**（后端读取系统字体列表，见 api/fonts.ts）。
 *
 * 字体栈末尾统一补系统中文，保证中英混排都不缺字形。
 */

export interface FontOption {
  /** 配置中存储的标识：内置为 `system`，系统字体为 `sys:<字族名>` */
  value: string
  /** 下拉框展示名 */
  label: string
  /** 实际字体栈 */
  stack: string
}

/** 中文回退字体（Windows / macOS 常见内置） */
const CJK_FALLBACK = '"Microsoft YaHei", "PingFang SC", sans-serif'

/** 内置默认界面字体栈（Nunito 由 assets 本地提供） */
export const DEFAULT_FONT_STACK = `"Nunito", ${CJK_FALLBACK}`

/** 内置字体的配置值 */
export const BUILTIN_FONT_VALUE = 'system'

/** 系统字体的配置值前缀 */
export const SYSTEM_FONT_PREFIX = 'sys:'

/** 默认字体标识 */
export const DEFAULT_FONT = BUILTIN_FONT_VALUE

/**
 * 根据本机字体列表拼出下拉选项。
 * 内置字体始终排在最前，其余按后端返回的顺序（已按名称排序）。
 */
export function buildFontOptions(systemFonts: string[]): FontOption[] {
  const options: FontOption[] = [
    {
      value: BUILTIN_FONT_VALUE,
      label: 'Nunito（内置默认）',
      stack: DEFAULT_FONT_STACK,
    },
  ]

  for (const name of systemFonts) {
    options.push({
      value: `${SYSTEM_FONT_PREFIX}${name}`,
      label: name,
      stack: `"${name}", ${CJK_FALLBACK}`,
    })
  }

  return options
}

/**
 * 把配置值解析为字体栈。
 *
 * 注意：不依赖下拉选项列表是否已加载——系统字体值自带字族名，
 * 因此应用启动时（未打开设置面板）也能正确应用。
 */
export function fontStackOf(value: string | undefined): string {
  if (value && value.startsWith(SYSTEM_FONT_PREFIX)) {
    const name = value.slice(SYSTEM_FONT_PREFIX.length)
    if (name) {
      return `"${name}", ${CJK_FALLBACK}`
    }
  }
  return DEFAULT_FONT_STACK
}
