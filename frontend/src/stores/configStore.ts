import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { fetchSettings, persistSetting } from '@/api/settings'
import type { ControlSize, SettingKey, ThemeMode } from '@/types'

/** 防抖保存间隔 */
const SAVE_DEBOUNCE_MS = 400

/** 配置项默认值，与后端 defaultSettings 保持一致 */
const DEFAULTS: Record<SettingKey, string> = {
  theme: 'dark',
  font_size: '13',
  control_size: 'default',
  editor_font_size: '13',
  log_max_lines: '200',
}

export const useConfigStore = defineStore('config', () => {
  /** 全部配置的原始字符串值 */
  const values = ref<Record<string, string>>({ ...DEFAULTS })
  const loaded = ref(false)
  const error = ref('')

  /** 主题 */
  const theme = computed<ThemeMode>(() =>
    values.value.theme === 'light' ? 'light' : 'dark',
  )

  /** 全局字体大小（px） */
  const fontSize = computed(() => toNumber(values.value.font_size, 13))

  /** Element Plus 控件尺寸 */
  const controlSize = computed<ControlSize>(() => {
    const size = values.value.control_size
    return size === 'large' || size === 'small' ? size : 'default'
  })

  /** Monaco 编辑器字号 */
  const editorFontSize = computed(() => toNumber(values.value.editor_font_size, 13))

  /** 执行日志保留条数 */
  const logMaxLines = computed(() => toNumber(values.value.log_max_lines, 200))

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

  /** 设置某项配置并立即生效 */
  function set(key: SettingKey, value: string) {
    if (values.value[key] === value) {
      return
    }
    values.value[key] = value
    applyTheme()
    applyFontSize()
    scheduleSave(key)
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
    }
  }

  // ------------------------------------------------------------ 应用外观

  /** 应用主题：切换 html 的 dark class */
  function applyTheme() {
    const root = document.documentElement
    if (theme.value === 'dark') {
      root.classList.add('dark')
    }
    else {
      root.classList.remove('dark')
    }
  }

  /** 应用全局字体大小：写入根节点 CSS 变量，供各处引用 */
  function applyFontSize() {
    document.documentElement.style.setProperty('--app-font-size', `${fontSize.value}px`)
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
    logMaxLines,
    // actions
    get,
    set,
    load,
    applyTheme,
    applyFontSize,
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
