import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { fetchSettings, persistSetting } from '@/api/settings'
import { DEFAULT_FONT, fontStackOf } from '@/utils/fonts'
import type { ControlSize, SettingKey, ThemeMode } from '@/types'

/** 防抖保存间隔 */
const SAVE_DEBOUNCE_MS = 400

/**
 * 主题缓存键。
 * 同时被 index.html 的内联脚本读取（同步执行），
 * 用于在首帧就应用正确主题，避免等待后端配置往返造成的闪屏。
 */
const APP_THEME_STORAGE_KEY = 'toolbox-theme'

/** 配置项默认值，与后端 defaultSettings 保持一致 */
const DEFAULTS: Record<SettingKey, string> = {
  theme: 'dark',
  font_size: '13',
  control_size: 'default',
  editor_font_size: '13',
  log_max_lines: '200',
  background_alpha: '100',
  background_blur: '0',
  font_family: DEFAULT_FONT,
  editor_font_family: DEFAULT_FONT,
}

export const useConfigStore = defineStore('config', () => {
  /** 全部配置的原始字符串值 */
  const values = ref<Record<string, string>>({ ...DEFAULTS })
  const loaded = ref(false)
  const error = ref('')

  /** 主题；未知值回退到默认深蓝 */
  const theme = computed<ThemeMode>(() => {
    const raw = values.value.theme
    return raw === 'light' || raw === 'midnight' || raw === 'idea' ? raw : 'dark'
  })

  /** 全局字体大小（px） */
  const fontSize = computed(() => toNumber(values.value.font_size, 13))

  /** Element Plus 控件尺寸 */
  const controlSize = computed<ControlSize>(() => {
    const size = values.value.control_size
    return size === 'large' || size === 'small' ? size : 'default'
  })

  /** Monaco 编辑器字号 */
  const editorFontSize = computed(() => toNumber(values.value.editor_font_size, 13))

  /** 编辑器字体标识；独立于界面字体，可单独设置 */
  const editorFontFamily = computed(() => values.value.editor_font_family || DEFAULT_FONT)

  /** 编辑器字体栈（供 Monaco 的 fontFamily 使用） */
  const editorFontStack = computed(() => fontStackOf(editorFontFamily.value))

  /** 执行日志保留条数 */
  const logMaxLines = computed(() => toNumber(values.value.log_max_lines, 200))

  /** 窗口背景透明度（百分比，100 为不透明） */
  const backgroundAlpha = computed(() =>
    clamp(toNumber(values.value.background_alpha, 100), 20, 100),
  )

  /** 窗口背景磨砂模糊半径（px，0 为关闭） */
  const backgroundBlur = computed(() => clamp(toNumber(values.value.background_blur, 0), 0, 40))

  /** 界面字体标识 */
  const fontFamily = computed(() => values.value.font_family || DEFAULT_FONT)

  /** 界面字体栈（供 CSS 变量与 Monaco 使用） */
  const fontFamilyStack = computed(() => fontStackOf(fontFamily.value))

  /** 按 key 取值 */
  function get(key: SettingKey): string {
    return values.value[key] ?? DEFAULTS[key]
  }

  // ------------------------------------------------------------ 持久化

  let saveTimer: number | null = null
  const dirtyKeys = new Set<string>()

  /** 防抖写入后端 */
  function scheduleSave(key: string) {
    dirtyKeys.add(key)
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer)
    }
    saveTimer = window.setTimeout(async () => {
      saveTimer = null
      const keys = Array.from(dirtyKeys)
      dirtyKeys.clear()

      for (const item of keys) {
        try {
          await persistSetting(item, values.value[item] ?? '')
        }
        catch (e) {
          error.value = e instanceof Error ? e.message : String(e)
        }
      }
    }, SAVE_DEBOUNCE_MS)
  }

  /**
   * 设置某项配置并立即生效。
   *
   * 只应用与该 key 相关的外观，避免改字号时也去重算背景合成（会强制一次布局）。
   */
  function set(key: SettingKey, value: string) {
    if (values.value[key] === value) {
      return
    }
    values.value[key] = value
    applyByKey(key)
    scheduleSave(key)
  }

  /** 按配置项分派到对应的外观应用函数 */
  function applyByKey(key: SettingKey) {
    switch (key) {
      case 'theme':
        applyTheme()
        break
      case 'font_size':
        applyFontSize()
        break
      case 'control_size':
        applyControlScale()
        break
      case 'font_family':
        applyFontFamily()
        break
      case 'editor_font_family':
        // 编辑器字体无需写 CSS 变量：MonacoEditor 直接读 editorFontStack，options 变化即生效
        break
      case 'background_alpha':
      case 'background_blur':
        applyBackground()
        break
      default:
        break
    }
  }

  /** 从后端加载配置 */
  async function load() {
    try {
      const list = await fetchSettings()
      const next: Record<string, string> = { ...DEFAULTS }
      for (const item of list) {
        next[item.key] = item.value
      }
      values.value = next
      error.value = ''
    }
    catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
    finally {
      loaded.value = true
      applyTheme()
      applyFontSize()
      applyControlScale()
      applyFontFamily()
      applyBackground()
    }
  }

  // ------------------------------------------------------------ 应用外观

  /**
   * 应用主题：
   *  - `.dark` 类区分明暗两族（亮色为 light，其余为暗色）；
   *  - `data-theme` 指定具体配色，扩展主题在其之上覆盖 CSS 变量。
   */
  function applyTheme() {
    const root = document.documentElement
    const isDark = theme.value !== 'light'
    if (isDark) {
      root.classList.add('dark')
    }
    else {
      root.classList.remove('dark')
    }
    root.dataset.theme = theme.value

    // 缓存主题：HTML 首帧据此同步应用，避免等待后端往返造成的亮→暗闪屏
    try {
      localStorage.setItem(APP_THEME_STORAGE_KEY, theme.value)
    }
    catch {
      // 隐私模式等场景下 localStorage 不可用时忽略
    }
  }

  /** 应用全局字体大小：写入根节点 CSS 变量，供各处引用 */
  function applyFontSize() {
    document.documentElement.style.setProperty('--app-font-size', `${fontSize.value}px`)
  }

  /**
   * 应用控件大小：写入倍率变量。
   *
   * 全局 CSS（global.css）用它缩放 Element Plus 的三档控件高度，
   * 这样即使组件上写死了 size="small" 也会跟着一起变；
   * `<ElConfigProvider :size>` 则负责让组件选中对应档位的变量。
   */
  function applyControlScale() {
    const scale = controlSize.value === 'small' ? 0.9 : controlSize.value === 'large' ? 1.1 : 1
    document.documentElement.style.setProperty('--app-control-scale', String(scale))
  }

  /** 应用界面字体：写入根节点 CSS 变量，供 body 与各组件引用 */
  function applyFontFamily() {
    document.documentElement.style.setProperty('--app-font-family', fontFamilyStack.value)
  }

  /**
   * 应用窗口背景效果：写入透明度与磨砂的 CSS 变量。
   * 底色与 backdrop-filter 都在 #app-backdrop 层上，不作用于内容本身。
   */
  function applyBackground() {
    const root = document.documentElement
    root.style.setProperty('--app-bg-alpha', String(backgroundAlpha.value / 100))
    root.style.setProperty('--app-bg-blur', `${backgroundBlur.value}px`)

    /*
     * 强制背景层重新合成。
     * backdrop-filter 的模糊结果会被缓存，仅改 CSS 变量时
     * 部分情况下不会立即重绘，读一次布局属性可触发重新合成。
     */
    const backdrop = document.getElementById('app-backdrop')
    if (backdrop) {
      void backdrop.offsetHeight
    }
  }

  return {
    // state
    values,
    loaded,
    error,
    // getters
    theme,
    fontSize,
    controlSize,
    editorFontSize,
    editorFontFamily,
    editorFontStack,
    logMaxLines,
    backgroundAlpha,
    backgroundBlur,
    fontFamily,
    fontFamilyStack,
    // actions
    get,
    set,
    load,
    applyTheme,
    applyFontSize,
    applyControlScale,
    applyFontFamily,
    applyBackground,
  }
})

/** 把配置值安全转为数字，解析失败时回退默认值 */
function toNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') {
    return fallback
  }
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 把数值限制在指定区间内 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
