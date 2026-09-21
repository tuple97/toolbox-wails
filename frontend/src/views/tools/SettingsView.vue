<script setup lang="ts">
/** 设置（单例标签页）：改动即时生效并自动保存 */
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
import { useUpdateStore } from '@/stores/updateStore'
import { installUpdate } from '@/utils/appUpdate'
import { buildFontOptions } from '@/utils/fonts'
import { notify } from '@/utils/notify'
import { SQL_TRIGGER_MODE_OPTIONS, parseSqlTriggerMode } from '@/utils/sql/sqlCompletionTrigger'
import { parseShowSystemDatabases } from '@/utils/sql/sqlVisibility'
import { parsePlaceholderTabJump } from '@/utils/sql/template/templatePlaceholder'
import type { ThemeMode } from '@/types'

const configStore = useConfigStore()
const logStore = useLogStore()
const metadataStore = useMetadataStore()
/** 更新状态由后端快照驱动（见 stores/updateStore.ts），本页只读 */
const updateStore = useUpdateStore()

const emit = defineEmits<{
  /** 首次加载完成 */
  (e: 'ready'): void
}>()

// ---------------------------------------------------------------- 页签

const TABS = [
  { value: 'general', label: '外观' },
  { value: 'editor', label: '编辑器' },
  { value: 'sql', label: 'SQL' },
  { value: 'template', label: '模板' },
  { value: 'advanced', label: '高级' },
  { value: 'update', label: '更新' },
]

/** 当前页签 */
const activeTab = ref('general')

// ---------------------------------------------------------------- 外观

const themeOptions: Array<{ label: string, value: string }> = [
  { label: '深蓝（默认）', value: 'dark' },
  { label: '极夜黑', value: 'midnight' },
  { label: 'IDEA 风格', value: 'idea' },
  { label: '亮色', value: 'light' },
]

/* v-model 是 string，类型收窄放在 setter 里做 */
const theme = computed<string>({
  get: () => configStore.theme,
  set: (value: string) => configStore.set('theme', value as ThemeMode),
})

/** 缩放比例的预设档位（百分比） */
const SCALE_STEPS = [80, 90, 100, 110, 120, 130, 150]

/** 缩放比例（下拉框，百分比） */
const uiScale = computed<string>({
  get: () => String(Math.round(configStore.uiScale * 100)),
  set: (value: string) => configStore.set('ui_scale', value),
})

/** 缩放比例下拉选项：预设档位 + 配置里的值 */
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

/** 本机已安装字体 */
const systemFonts = ref<string[]>([])

/** 字体下拉选项：内置字体 + 本机字体 */
const fontChoices = computed(() =>
  buildFontOptions(systemFonts.value).map(option => ({ label: option.label, value: option.value })))

// ---------------------------------------------------------------- 编辑器

/** 编辑器字体 */
const editorFontFamily = computed({
  get: () => configStore.editorFontFamily,
  set: (value: string) => configStore.set('editor_font_family', value),
})

// ---------------------------------------------------------------- SQL

const sqlTriggerMode = computed({
  get: () => parseSqlTriggerMode(configStore.values.sql_completion_trigger),
  set: (value: string) => configStore.set('sql_completion_trigger', value),
})

/** 提示触发方式的候选 */
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

/** 元数据缓存规模 */
const metadataCache = computed(() => ({
  databases: Object.keys(metadataStore.databases).length,
  tables: Object.keys(metadataStore.tables).length,
  columns: Object.keys(metadataStore.columns).length,
}))

/** 页内状态行（3 秒后淡出） */
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

/** 恢复默认设置的两段式确认状态 */
const resetArmed = ref(false)

function resetSettings() {
  if (!resetArmed.value) {
    resetArmed.value = true
    return
  }
  configStore.resetAll()
  // 日志上限需显式同步给 logStore
  logStore.setMaxLines(configStore.logMaxLines)
  resetArmed.value = false
  flash('已恢复默认设置')
}

// ---------------------------------------------------------------- 更新

/** 自动检查更新（默认开启） */
const autoUpdate = computed({
  get: () => configStore.values.app_auto_update === 'true',
  set: (value: boolean) => configStore.set('app_auto_update', value ? 'true' : 'false'),
})

/** 当前版本号（以后端快照为准，不另外查一次应用信息） */
const currentVersionLabel = computed(() =>
  updateStore.snapshot.currentVersion ? `v${updateStore.snapshot.currentVersion}` : '—',
)

/** 是否处于「进行中」阶段：下载 / 校验 / 安装 */
const updateInProgress = computed(() =>
  ['downloading', 'verifying', 'installing'].includes(updateStore.state),
)

/** 进度文案：区分下载 / 校验 / 安装 */
const updateProgressLabel = computed(() => {
  switch (updateStore.state) {
    case 'verifying':
      return '正在校验更新包…'
    case 'installing':
      return '正在安装更新…'
    default:
      return updateStore.progress >= 0 ? `${updateStore.progress}%` : '下载中'
  }
})

/** 进度条宽度（总长未知时不铺满） */
const updateProgressWidth = computed(() => `${updateStore.progress > 0 ? updateStore.progress : 0}%`)

/** 下载并安装（弹窗编排与启动流程共用一套） */
function handleInstallUpdate() {
  void installUpdate()
}

onMounted(async () => {
  // 打开本页时对齐一次权威状态：即便更新早就开始（启动自动检查），这里也能看到
  void updateStore.refresh()
  try {
    systemFonts.value = await fetchSystemFonts()
  }
  finally {
    // 失败也要上报
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
    </header>

    <Tabs v-model="activeTab" :items="TABS" class="mb-3" />

    <p v-if="status" class="mb-2 text-xs text-brand">
      {{ status }}
    </p>

    <!-- 外观 -->
    <section v-show="activeTab === 'general'" class="max-w-3xl space-y-1">
      <Field label="主题">
        <Combobox v-model="theme" :options="themeOptions" />
      </Field>

      <Field label="缩放比例">
        <Combobox v-model="uiScale" :options="scaleChoices" />
      </Field>

      <Field label="界面字体">
        <Combobox
          v-model="fontFamily"
          :options="fontChoices"
          search-placeholder="搜索字体…"
        />
      </Field>
    </section>

    <!-- 编辑器 -->
    <section v-show="activeTab === 'editor'" class="max-w-3xl space-y-1">
      <Field label="编辑器字体">
        <Combobox
          v-model="editorFontFamily"
          :options="fontChoices"
          search-placeholder="搜索字体…"
        />
      </Field>
    </section>

    <!-- SQL -->
    <section v-show="activeTab === 'sql'" class="max-w-3xl space-y-1">
      <Field label="提示触发">
        <Combobox v-model="sqlTriggerMode" :options="triggerChoices" />
      </Field>

      <Field label="表名自动别名">
        <Switch v-model="sqlAutoAlias" />
      </Field>

      <Field label="展示系统库">
        <Switch v-model="sqlShowSystemDatabases" />
      </Field>
    </section>

    <!-- 模板 -->
    <section v-show="activeTab === 'template'" class="max-w-3xl space-y-1">
      <Field label="占位符跳转">
        <Switch v-model="templatePlaceholderTab" />
      </Field>
    </section>

    <!-- 高级 -->
    <section v-show="activeTab === 'advanced'" class="max-w-3xl space-y-1">
      <Field label="日志保留条数">
        <div class="flex items-center gap-3">
          <Slider v-model="logMaxLines" :min="50" :max="1000" :step="50" class="w-56" />
          <span class="w-12 text-sm text-muted">{{ logMaxLines }}</span>
        </div>
      </Field>

      <Field label="元数据缓存">
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

      <Field label="恢复默认设置">
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

    <!-- 更新 -->
    <section v-show="activeTab === 'update'" class="max-w-3xl space-y-1">
      <Field label="当前版本">
        <span class="text-sm text-muted">{{ currentVersionLabel }}</span>
      </Field>

      <Field label="自动检查更新">
        <Switch v-model="autoUpdate" />
      </Field>

      <Field label="检查更新">
        <div class="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            :loading="updateStore.state === 'checking'"
            :disabled="!updateStore.snapshot.canCheck"
            @click="updateStore.check()"
          >
            检查更新
          </Button>
          <span v-if="updateStore.state === 'up-to-date'" class="text-sm text-muted">已是最新版本</span>
          <span v-else-if="updateStore.error" class="text-sm text-danger">{{ updateStore.error }}</span>
          <span v-else-if="updateStore.snapshot.message" class="text-sm text-muted">
            {{ updateStore.snapshot.message }}
          </span>
        </div>
      </Field>

      <!-- 发现新版本：下载入口（失败后按钮变成重试） -->
      <div
        v-if="updateStore.snapshot.canDownload"
        class="space-y-2 rounded-md border border-brand/30 bg-brand/8 p-3"
      >
        <div class="text-sm font-semibold text-brand">
          发现新版本 v{{ updateStore.snapshot.latestVersion }}
        </div>
        <p
          v-if="updateStore.snapshot.notes"
          class="max-h-40 overflow-auto whitespace-pre-line text-xs text-muted"
        >
          {{ updateStore.snapshot.notes }}
        </p>
        <Button size="sm" @click="handleInstallUpdate">
          {{ updateStore.state === 'error' ? '重试下载' : '下载并安装' }}
        </Button>
      </div>

      <!-- 下载 / 校验 / 安装：都算「进行中」，进度条常驻（后端快照带阶段） -->
      <Field v-if="updateInProgress" label="更新进度">
        <div class="flex items-center gap-3">
          <div class="h-1.5 w-56 overflow-hidden rounded-full bg-muted/20">
            <div
              class="h-full bg-brand transition-[width] duration-200"
              :style="{ width: updateProgressWidth }"
            />
          </div>
          <span class="text-sm text-muted">{{ updateProgressLabel }}</span>
          <Button
            v-if="updateStore.state === 'downloading'"
            variant="secondary"
            size="sm"
            :disabled="!updateStore.snapshot.canCancel"
            @click="updateStore.cancel()"
          >
            取消下载
          </Button>
        </div>
      </Field>

      <Field v-if="updateStore.state === 'ready'" label="更新已就绪">
        <div class="flex items-center gap-3">
          <span class="text-sm text-muted">重启应用后生效</span>
          <Button size="sm" :disabled="!updateStore.snapshot.canRestart" @click="updateStore.restart()">
            立即重启
          </Button>
        </div>
      </Field>
    </section>
  </div>
</template>
