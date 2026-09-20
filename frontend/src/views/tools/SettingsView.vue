<script setup lang="ts">
/**
 * 设置（单例标签页）。
 *
 * 全部改动即时生效并自动保存（configStore 内部有防抖落盘），因此没有「保存」按钮。
 * 反馈用页内的**状态行**而不是弹层提示：设置页本来就是「改一下、看一眼」的节奏，
 * 弹窗会打断这个节奏；「恢复默认设置」也用两段式按钮（就地变成确认/取消），
 * 不为了一个确认再引一套弹窗。
 *
 * 这一页是 UI 迁移（Element Plus → Tailwind + components/ui）的第一个切片：
 * 所有控件都来自 `components/ui`，字号与间距自动跟随「缩放比例」。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Button from '@/components/ui/Button.vue'
import Combobox from '@/components/ui/Combobox.vue'
import Field from '@/components/ui/Field.vue'
import Slider from '@/components/ui/Slider.vue'
import Switch from '@/components/ui/Switch.vue'
import Tabs from '@/components/ui/Tabs.vue'
import { fetchSystemFonts } from '@/api/fonts'
import { useConfigStore } from '@/stores/configStore'
import { useLogStore } from '@/stores/logStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { buildFontOptions } from '@/utils/fonts'
import { SQL_TRIGGER_MODE_OPTIONS, parseSqlTriggerMode } from '@/utils/sql/sqlCompletionTrigger'
import { parseShowSystemDatabases } from '@/utils/sql/sqlVisibility'
import { parsePlaceholderTabJump } from '@/utils/sql/template/templatePlaceholder'
import type { ThemeMode } from '@/types'

const configStore = useConfigStore()
const logStore = useLogStore()
const metadataStore = useMetadataStore()

const emit = defineEmits<{
  /** 首次加载完成（父级据此关闭 loading 遮罩） */
  (e: 'ready'): void
}>()

// ---------------------------------------------------------------- 页签

const TABS = [
  { value: 'general', label: '外观' },
  { value: 'editor', label: '编辑器' },
  { value: 'sql', label: 'SQL' },
  { value: 'template', label: '模板' },
  { value: 'advanced', label: '高级' },
]

/** 页签只切换显隐（`v-show`）：各分组都是纯配置，但保持一致的项目约定 */
const activeTab = ref('general')

// ---------------------------------------------------------------- 外观

const themeOptions: Array<{ label: string, value: string }> = [
  { label: '深蓝（默认）', value: 'dark' },
  { label: '极夜黑', value: 'midnight' },
  { label: 'IDEA 风格', value: 'idea' },
  { label: '亮色', value: 'light' },
]

/*
 * 下拉/分段控件的 v-model 是 string，而 store 里的类型是字面量联合：
 * computed 显式标成 string，把类型收窄放在 setter 里做（避免模板上的类型不匹配）。
 */
const theme = computed<string>({
  get: () => configStore.theme,
  set: (value: string) => configStore.set('theme', value as ThemeMode),
})

/** 缩放比例的预设档位（百分比） */
const SCALE_STEPS = [80, 90, 100, 110, 120, 130, 150]

/**
 * 缩放比例（下拉框，百分比）。
 *
 * 基准字号 13px 由它放大缩小，界面里所有字号（含尚未迁移的 Element Plus 页面）
 * 与控件高度一起跟随 —— 实现见 configStore.applyUiScale 与 styles/tailwind.css。
 */
const uiScale = computed<string>({
  get: () => String(Math.round(configStore.uiScale * 100)),
  set: (value: string) => configStore.set('ui_scale', value),
})

/**
 * 下拉选项：预设档位 + 配置里的值（若它不在预设里）。
 *
 * 加最后一项是为了「手改过的值」：设置面板只给预设，但配置文件里可能有 115 这种值，
 * 不给它一项下拉就会显示成 placeholder，看起来像「没设置」——那是撒谎。
 */
const scaleChoices = computed(() => {
  const current = Math.round(configStore.uiScale * 100)
  const values = SCALE_STEPS.includes(current)
    ? SCALE_STEPS
    : [...SCALE_STEPS, current].sort((left, right) => left - right)
  return values.map(value => ({
    label: value === 100 ? '100%（默认）' : `${value}%`,
    value: String(value),
  }))
})

const fontFamily = computed({
  get: () => configStore.fontFamily,
  set: (value: string) => configStore.set('font_family', value),
})

/** 本机已安装字体（进入设置页时加载一次） */
const systemFonts = ref<string[]>([])

/** 字体下拉选项：内置字体 + 本机字体（下拉框只吃 label/value，字体栈由 store 算） */
const fontChoices = computed(() =>
  buildFontOptions(systemFonts.value).map(option => ({ label: option.label, value: option.value })))

// ---------------------------------------------------------------- 编辑器

/** 编辑器字体（独立于界面字体，选项与「外观 → 界面字体」共用同一套） */
const editorFontFamily = computed({
  get: () => configStore.editorFontFamily,
  set: (value: string) => configStore.set('editor_font_family', value),
})

// ---------------------------------------------------------------- SQL

const sqlTriggerMode = computed({
  get: () => parseSqlTriggerMode(configStore.values.sql_completion_trigger),
  set: (value: string) => configStore.set('sql_completion_trigger', value),
})

/** 提示触发方式的候选（带一句说明，长按列表里逐条读得懂） */
const triggerChoices = SQL_TRIGGER_MODE_OPTIONS.map(option => ({
  label: option.label,
  value: option.value,
  hint: option.hint,
}))

const sqlAutoAlias = computed({
  get: () => configStore.values.sql_completion_alias === 'true',
  set: (value: boolean) => configStore.set('sql_completion_alias', value ? 'true' : 'false'),
})

const sqlShowSystemDatabases = computed({
  get: () => parseShowSystemDatabases(configStore.values.sql_show_system_databases),
  set: (value: boolean) => configStore.set('sql_show_system_databases', value ? 'true' : 'false'),
})

// ---------------------------------------------------------------- 模板

const templatePlaceholderTab = computed({
  get: () => parsePlaceholderTabJump(configStore.values.template_placeholder_tab),
  set: (value: boolean) => configStore.set('template_placeholder_tab', value ? 'true' : 'false'),
})

// ---------------------------------------------------------------- 高级

const logMaxLines = computed({
  get: () => configStore.logMaxLines,
  set: (value: number) => {
    configStore.set('log_max_lines', String(value))
    logStore.setMaxLines(value)
  },
})

/** 元数据缓存规模：既是「清空」的说明书，也让「清完还是不是旧的」一眼可验 */
const metadataCache = computed(() => ({
  databases: Object.keys(metadataStore.databases).length,
  tables: Object.keys(metadataStore.tables).length,
  columns: Object.keys(metadataStore.columns).length,
}))

/** 页内状态行（成功/失败一句话，3 秒后淡出） */
const status = ref('')
let statusTimer: number | null = null

function flash(message: string) {
  status.value = message
  if (statusTimer) {
    window.clearTimeout(statusTimer)
  }
  statusTimer = window.setTimeout(() => {
    status.value = ''
  }, 3000)
}

function clearMetadataCache() {
  metadataStore.clear()
  flash('元数据缓存已清空，下次补全会重新读取')
}

/** 「恢复默认设置」的两段式确认：第一次点击只是把按钮换成确认/取消 */
const resetArmed = ref(false)

function resetSettings() {
  if (!resetArmed.value) {
    resetArmed.value = true
    return
  }
  configStore.resetAll()
  // 日志上限不在 configStore 的外观应用范围内，需要显式同步给 logStore
  logStore.setMaxLines(configStore.logMaxLines)
  resetArmed.value = false
  flash('已恢复默认设置')
}

onMounted(async () => {
  try {
    systemFonts.value = await fetchSystemFonts()
  }
  finally {
    // 失败也要上报，否则遮罩会一直盖住界面
    emit('ready')
  }
})

onBeforeUnmount(() => {
  if (statusTimer) {
    window.clearTimeout(statusTimer)
  }
})
</script>

<template>
  <div class="h-full overflow-auto px-6 py-5">
    <header class="mb-4 flex items-center gap-2">
      <span class="h-4 w-1 rounded-full bg-brand" aria-hidden="true" />
      <span class="font-semibold text-text">设置</span>
      <small class="text-xs text-muted">修改即时生效并自动保存</small>
    </header>

    <Tabs v-model="activeTab" :items="TABS" class="mb-3" />

    <p v-if="status" class="mb-2 text-xs text-brand">
      {{ status }}
    </p>

    <!-- 外观 -->
    <section v-show="activeTab === 'general'" class="max-w-3xl space-y-1">
      <Field label="主题" hint="切换后整个应用（含编辑器配色）立即跟随">
        <Combobox v-model="theme" :options="themeOptions" />
      </Field>

      <Field
        label="缩放比例"
        hint="基准字号 13px 按此比例放大缩小：界面字号、控件高度与代码字号一起跟随，因此不再单独提供「控件大小」「编辑器字号」；其余字号在基准上下 ±1~3px 波动。"
      >
        <Combobox v-model="uiScale" :options="scaleChoices" />
      </Field>

      <Field label="界面字体" hint="内置 Nunito 随应用打包；其余为本机已安装字体（可搜索筛选）。">
        <Combobox
          v-model="fontFamily"
          :options="fontChoices"
          search-placeholder="搜索字体…"
        />
      </Field>
    </section>

    <!-- 编辑器 -->
    <section v-show="activeTab === 'editor'" class="max-w-3xl space-y-1">
      <Field label="编辑器字体" hint="独立于界面字体：等宽字体在这里选，代码对齐才正常；字号跟随「外观 → 缩放比例」。">
        <Combobox
          v-model="editorFontFamily"
          :options="fontChoices"
          search-placeholder="搜索字体…"
        />
      </Field>
    </section>

    <!-- SQL -->
    <section v-show="activeTab === 'sql'" class="max-w-3xl space-y-1">
      <Field label="提示触发" hint="决定 SQL 编辑器何时自动弹出候选（Ctrl+Space 始终可用）。">
        <Combobox v-model="sqlTriggerMode" :options="triggerChoices" />
      </Field>

      <Field
        label="表名自动别名"
        hint="在 FROM / JOIN 之后补一个短别名（users AS u、order_items AS oi）；开启后候选只给带别名的这一条。"
      >
        <Switch v-model="sqlAutoAlias" />
      </Field>

      <Field
        label="展示系统库"
        hint="关闭后库选择下拉与 SQL 补全候选不再列出系统库（information_schema、mysql、sys 等）；手动写下的 mysql.user 仍然照常解析（隐藏不等于非法）。"
      >
        <Switch v-model="sqlShowSystemDatabases" />
      </Field>
    </section>

    <!-- 模板 -->
    <section v-show="activeTab === 'template'" class="max-w-3xl space-y-1">
      <Field
        label="占位符跳转"
        hint="插入块片段（if / end 骨架）后，主光标停在块头条件的占位处，Tab 依次跳到下一个占位、Shift+Tab 反向，走完全部占位后恢复常规行为。关闭后 Tab 只做缩进。"
      >
        <Switch v-model="templatePlaceholderTab" />
      </Field>
    </section>

    <!-- 高级 -->
    <section v-show="activeTab === 'advanced'" class="max-w-3xl space-y-1">
      <Field label="日志保留条数" hint="日志面板最多保留的条数，超出后丢弃最旧的。">
        <div class="flex items-center gap-3">
          <Slider v-model="logMaxLines" :min="50" :max="1000" :step="50" class="w-56" />
          <span class="w-12 text-sm text-muted">{{ logMaxLines }}</span>
        </div>
      </Field>

      <Field
        label="元数据缓存"
        hint="补全与悬停用的库 / 表 / 字段都来自这份缓存（失败也会缓存，避免反复重试）；库表刚有变更时可清空，下次补全会重新读取。"
      >
        <div class="flex items-center gap-3">
          <span class="text-sm text-muted">
            {{ metadataCache.databases }} 个库 · {{ metadataCache.tables }} 份库表清单 ·
            {{ metadataCache.columns }} 张表的字段
          </span>
          <Button variant="secondary" size="sm" @click="clearMetadataCache">
            清空缓存
          </Button>
        </div>
      </Field>

      <Field
        label="恢复默认设置"
        hint="只重置全部配置项（主题、字体、缩放、日志、SQL 补全等）；数据库连接、SQL 模板、词典与 Tab 工作台都不受影响。"
      >
        <div class="flex items-center gap-2">
          <Button
            :variant="resetArmed ? 'danger' : 'secondary'"
            size="sm"
            @click="resetSettings"
          >
            {{ resetArmed ? '确认恢复默认' : '恢复默认设置' }}
          </Button>
          <Button v-if="resetArmed" variant="ghost" size="sm" @click="resetArmed = false">
            取消
          </Button>
        </div>
      </Field>
    </section>
  </div>
</template>
