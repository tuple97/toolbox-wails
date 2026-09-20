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
  // 界面缩放比例（百分比，100 = 100%）：基准字号 13px 由它放大/缩小
  ui_scale: '100',
  /*
   * 历史配置项：这几个不再作为设置页里的独立选项 —— 字号、控件高度、代码字号
   * 都已由「缩放比例」统一承担。保留默认值与运行时读取路径（applyControlScale、
   * CodeEditor 的字号 calc），于是磁盘上已有的自定义值仍然生效。
   */
  font_size: '13',
  control_size: 'default',
  editor_font_size: '13',
  log_max_lines: '200',
  font_family: DEFAULT_FONT,
  editor_font_family: DEFAULT_FONT,
  sidebar_config: '{}',
  picker_config: '{}',
  sidebar_view: '{}',
  sql_completion_trigger: 'positional',
  sql_completion_alias: 'false',
  // 默认显示系统库：与改造前的行为一致（见 utils/sql/sqlVisibility.ts）
  sql_show_system_databases: 'true',
  // 模板块片段插入后，Tab 在占位符之间跳转（默认开启）
  template_placeholder_tab: 'true',
  shortcut_config: '{}',
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

  /**
   * 界面缩放比例（1 = 100%）。
   *
   * 兜住脏值：设置面板只给 80%~150%，手改配置也不该把界面搞成不可用。
   * 它是个**乘数**：根字号（13px × 它）、Tailwind 的字号 / 间距阶梯，
   * 以及自绘控件的高度都从它算出来。
   */
  const uiScale = computed(() => {
    const raw = toNumber(values.value.ui_scale, 100)
    return Math.min(Math.max(raw, 60), 200) / 100
  })

  /** 控件大小：历史配置项（设置页已不再提供，仅保留取值路径以兼容旧数据） */
  const controlSize = computed<ControlSize>(() => {
    const size = values.value.control_size
    return size === 'large' || size === 'small' ? size : 'default'
  })

  /** 编辑器字号（CodeMirror 6 封装层读取） */
  const editorFontSize = computed(() => toNumber(values.value.editor_font_size, 13))

  /** 编辑器字体标识；独立于界面字体，可单独设置 */
  const editorFontFamily = computed(() => values.value.editor_font_family || DEFAULT_FONT)

  /** 编辑器字体栈（供 CodeEditor 的 fontFamily 使用） */
  const editorFontStack = computed(() => fontStackOf(editorFontFamily.value))

  /** 执行日志保留条数 */
  const logMaxLines = computed(() => toNumber(values.value.log_max_lines, 200))

  /** 界面字体标识 */
  const fontFamily = computed(() => values.value.font_family || DEFAULT_FONT)

  /** 界面字体栈（供 CSS 变量与编辑器默认字体使用） */
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
      case 'ui_scale':
        applyUiScale()
        break
      case 'control_size':
        applyControlScale()
        break
      case 'font_family':
        applyFontFamily()
        break
      case 'editor_font_family':
        // 编辑器字体无需写 CSS 变量：CodeEditor 直接读 editorFontStack，变化时重配置 Compartment
        break
      default:
        break
    }
  }

  /**
   * 全部配置恢复默认值（设置页「高级 → 恢复默认设置」）。
   *
   * 逐项走 `set` 的待遇（应用到界面 + 排一次落盘），而不是直接替换 `values`：
   * 只改数据不改界面会留下「设置显示默认、实际还是旧值」的状态。
   * 每一项都提交保存，于是中途失败也只丢不上的那几项，不会整体静默失效。
   */
  function resetAll() {
    for (const key of Object.keys(DEFAULTS) as SettingKey[]) {
      set(key, DEFAULTS[key])
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
      applyUiScale()
      applyControlScale()
      applyFontFamily()
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

  /**
   * 应用缩放比例：只写一个 `--app-scale` 乘数。
   *
   * 根字号（13px × 它）、字号阶梯、Tailwind 的 rem 类（字号 / 间距 / 圆角）
   * 都由它算出来，所以不需要在这里逐个改字号 ——
   * 漏掉一个就会出现「一半大一半没变」。
   */
  function applyUiScale() {
    document.documentElement.style.setProperty('--app-scale', String(uiScale.value))
  }

  /**
   * 应用控件大小：写入倍率变量。
   *
   * 自绘组件（`components/ui/*`）在控件高度上乘 `--app-control-scale`，
   * 所以写一个变量就能让所有控件一起变；字号仍由缩放比例统一承担。
   */
  function applyControlScale() {
    const scale = controlSize.value === 'small' ? 0.9 : controlSize.value === 'large' ? 1.1 : 1
    document.documentElement.style.setProperty('--app-control-scale', String(scale))
  }

  /** 应用界面字体：写入根节点 CSS 变量，供 body 与各组件引用 */
  function applyFontFamily() {
    document.documentElement.style.setProperty('--app-font-family', fontFamilyStack.value)
  }

  return {
    // state
    values,
    loaded,
    error,
    // getters
    theme,
    uiScale,
    controlSize,
    editorFontSize,
    editorFontFamily,
    editorFontStack,
    logMaxLines,
    fontFamily,
    fontFamilyStack,
    // actions
    get,
    set,
    resetAll,
    load,
    applyTheme,
    applyUiScale,
    applyControlScale,
    applyFontFamily,
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
