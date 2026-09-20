/** 字体选项：内置默认字体 + 本机已安装字体 */

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

/** 内置默认字体栈（Inter，本机没装时回退中文系统字体） */
export const DEFAULT_FONT_STACK = `"Inter", ${CJK_FALLBACK}`

/** 内置字体的配置值 */
export const BUILTIN_FONT_VALUE = 'system'

/** 系统字体的配置值前缀 */
export const SYSTEM_FONT_PREFIX = 'sys:'

/** 默认字体标识 */
export const DEFAULT_FONT = BUILTIN_FONT_VALUE

/** 根据本机字体列表拼出下拉选项（内置字体始终排在最前） */
export function buildFontOptions(systemFonts: string[]): FontOption[] {
  const options: FontOption[] = [
    {
      value: BUILTIN_FONT_VALUE,
      label: 'Inter（内置默认）',
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

/** 把配置值解析为字体栈 */
export function fontStackOf(value: string | undefined): string {
  if (value && value.startsWith(SYSTEM_FONT_PREFIX)) {
    const name = value.slice(SYSTEM_FONT_PREFIX.length)
    if (name) {
      return `"${name}", ${CJK_FALLBACK}`
    }
  }
  return DEFAULT_FONT_STACK
}
