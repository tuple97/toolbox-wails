<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useConfigStore } from '@/stores/configStore'
import { useLogStore } from '@/stores/logStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { fetchSystemFonts } from '@/api/fonts'
import { buildFontOptions } from '@/utils/fonts'
import { SQL_TRIGGER_MODE_OPTIONS, parseSqlTriggerMode } from '@/utils/sql/sqlCompletionTrigger'
import { parseShowSystemDatabases } from '@/utils/sql/sqlVisibility'
import { parsePlaceholderTabJump } from '@/utils/sql/template/templatePlaceholder'
import { normalizeShortcut, parseShortcutConfig, shortcutFromEvent, shortcutOf, SHORTCUTS } from '@/utils/shortcuts'
import type { ControlSize, ThemeMode } from '@/types'

/**
 * 设置（单例标签页）。
 *
 * 所有修改即时生效并自动保存（configStore 内部有防抖落盘），
 * 因此这里不需要「保存」按钮。
 */

const configStore = useConfigStore()
const logStore = useLogStore()
const metadataStore = useMetadataStore()

const emit = defineEmits<{
  /** 首次加载完成（父级据此关闭 loading 遮罩） */
  (e: 'ready'): void
}>()

/** 主题选项 */
const themeOptions: Array<{ label: string, value: ThemeMode }> = [
  { label: '深蓝（默认）', value: 'dark' },
  { label: '极夜黑', value: 'midnight' },
  { label: 'IDEA 风格', value: 'idea' },
  { label: '亮色', value: 'light' },
]

/** 控件尺寸选项 */
const sizeOptions: Array<{ label: string, value: ControlSize }> = [
  { label: '大', value: 'large' },
  { label: '默认', value: 'default' },
  { label: '小', value: 'small' },
]

/** 主题 */
const theme = computed({
  get: () => configStore.theme,
  set: (value: ThemeMode) => configStore.set('theme', value),
})

/** 界面字体 */
const fontFamily = computed({
  get: () => configStore.fontFamily,
  set: (value: string) => configStore.set('font_family', value),
})

/** 本机已安装字体（进入设置页时加载一次） */
const systemFonts = ref<string[]>([])

/** 下拉选项：内置字体 + 本机字体 */
const fontOptions = computed(() => buildFontOptions(systemFonts.value))

/** 界面字体大小 */
const fontSize = computed({
  get: () => configStore.fontSize,
  set: (value: number) => configStore.set('font_size', String(value)),
})

/** 控件尺寸 */
function handleSizeChange(value: string | number | boolean | undefined) {
  configStore.set('control_size', String(value))
}

/** 编辑器字号 */
const editorFontSize = computed({
  get: () => configStore.editorFontSize,
  set: (value: number) => configStore.set('editor_font_size', String(value)),
})

/** 编辑器字体（独立于界面字体，选项与「外观 → 字体」共用同一套） */
const editorFontFamily = computed({
  get: () => configStore.editorFontFamily,
  set: (value: string) => configStore.set('editor_font_family', value),
})

/** 日志保留条数 */
const logMaxLines = computed({
  get: () => configStore.logMaxLines,
  set: (value: number) => {
    configStore.set('log_max_lines', String(value))
    logStore.setMaxLines(value)
  },
})

/** SQL 提示触发方式（三档，见 utils/sql/sqlCompletionTrigger.ts） */
const sqlTriggerMode = computed({
  get: () => parseSqlTriggerMode(configStore.values.sql_completion_trigger),
  set: (value: string) => configStore.set('sql_completion_trigger', value),
})

/** 表名补全后自动补别名 */
const sqlAutoAlias = computed({
  get: () => configStore.values.sql_completion_alias === 'true',
  set: (value: boolean) => configStore.set('sql_completion_alias', value ? 'true' : 'false'),
})

/**
 * 是否在库下拉框与 SQL 补全候选里展示系统库（设置项 `sql_show_system_databases`）。
 *
 * 判定策略在 utils/sql/sqlVisibility.ts：下拉与候选共用同一份，
 * 且只影响「主动展示」——显式写 `mysql.user` 仍然照常解析。
 */
const sqlShowSystemDatabases = computed({
  get: () => parseShowSystemDatabases(configStore.values.sql_show_system_databases),
  set: (value: boolean) => configStore.set('sql_show_system_databases', value ? 'true' : 'false'),
})

/** 模板：插入块片段后，Tab 是否在占位符之间跳转（设置项 `template_placeholder_tab`） */
const templatePlaceholderTab = computed({
  get: () => parsePlaceholderTabJump(configStore.values.template_placeholder_tab),
  set: (value: boolean) => configStore.set('template_placeholder_tab', value ? 'true' : 'false'),
})

/** 快捷键配置单独存成 JSON，未设置的动作始终回退到目录里的默认值。 */
const shortcutConfig = computed(() => parseShortcutConfig(configStore.values.shortcut_config))
function updateShortcut(id: string, value: string) {
  const next = { ...shortcutConfig.value }
  const normalized = normalizeShortcut(value)
  if (normalized) next[id] = normalized
  else delete next[id]
  const serialized = JSON.stringify(next)
  const scopeOf = (itemId: string) => {
    const group = SHORTCUTS.find(item => item.id === itemId)?.group
    // 全局与工作台动作无论当前在哪个页面都会监听，因此共享一个作用域。
    return group === '全局' || group === '工作台' ? 'global' : group
  }
  // 以“最终生效值”（包含未改过的默认键位）判断，避免自定义动作抢占全局快捷键。
  const duplicate = normalized && SHORTCUTS.find(item =>
    item.id !== id && scopeOf(item.id) === scopeOf(id) && shortcutOf(item.id, serialized) === normalized,
  )
  if (duplicate && normalized) {
    ElMessage.warning(`“${normalized}” 已分配给此页面的其他动作`)
    return
  }
  configStore.set('shortcut_config', JSON.stringify(next))
}
function resetShortcut(id: string) {
  const next = { ...shortcutConfig.value }
  delete next[id]
  configStore.set('shortcut_config', JSON.stringify(next))
}
function recordShortcut(id: string, event: KeyboardEvent) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
  // 普通字母仍可手输，组合键与 F 键则直接录入，避免浏览器抢走 Ctrl+W / Ctrl+R。
  if (!(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || /^F\d{1,2}$/i.test(event.key))) return
  event.preventDefault()
  event.stopPropagation()
  updateShortcut(id, shortcutFromEvent(event))
}

/**
 * 元数据缓存规模（高级页展示）。
 *
 * 缓存条数直接读 store 的响应式表：它既是「清空」这个动作的说明书
 * （用户能看到确实攒了东西），也让「清空完还是不是旧的」一眼可验。
 */
const metadataCache = computed(() => ({
  databases: Object.keys(metadataStore.databases).length,
  tables: Object.keys(metadataStore.tables).length,
  columns: Object.keys(metadataStore.columns).length,
}))

/** 清空元数据缓存：下次补全 / 悬停重新拉取（库表刚变更时用） */
function clearMetadataCache() {
  metadataStore.clear()
  ElMessage.success('元数据缓存已清空，下次补全会重新读取')
}

/**
 * 恢复默认设置。
 *
 * 只把配置项重置为默认值，**不动**元数据缓存与已保存的连接 / 模板 / Tab
 * —— 「恢复默认设置」不该顺手删掉用户的数据。
 */
async function resetSettings() {
  try {
    await ElMessageBox.confirm(
      '主题、字体、日志与 SQL 补全等全部设置将恢复为默认值（连接、模板与缓存不受影响），是否继续？',
      '恢复默认设置',
      { type: 'warning', confirmButtonText: '恢复', cancelButtonText: '取消' },
    )
  }
  catch {
    // Element Plus 用 reject 表示取消：什么都不做
    return
  }
  configStore.resetAll()
  // 日志上限不在 configStore 的外观应用范围内，需要显式同步给 logStore
  logStore.setMaxLines(configStore.logMaxLines)
  ElMessage.success('已恢复默认设置')
}

/** 设置页签（外观 / 编辑器 / SQL / 模板 / 快捷键 / 高级）；内容是纯配置，不必记住上次选中的页 */
const activeTab = ref('general')

onMounted(async () => {
  try {
    systemFonts.value = await fetchSystemFonts()
  }
  finally {
    // 失败也要上报，否则遮罩会一直盖住界面
    emit('ready')
  }
})
</script>

<template>
  <div class="settings-view">
    <header class="settings-view__head">
      <span class="settings-view__bar" aria-hidden="true" />
      <span>设置</span>
      <small>修改即时生效并自动保存</small>
    </header>

    <div class="settings-view__body">
      <el-tabs v-model="activeTab" class="settings-view__tabs">
        <el-tab-pane label="外观" name="general">
          <!-- 外观 -->
          <section class="settings-view__section">
            <h3 class="settings-view__section-title">外观</h3>

        <el-form label-width="110px" label-position="right">
          <el-form-item label="主题">
            <el-select v-model="theme" style="width: 100%">
              <el-option
                v-for="opt in themeOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="字体">
            <el-select v-model="fontFamily" filterable style="width: 100%">
              <el-option
                v-for="opt in fontOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
                :style="{ fontFamily: opt.stack }"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="字体大小">
            <div class="settings-view__slider">
              <el-slider v-model="fontSize" :min="12" :max="18" :step="1" show-stops />
              <span class="settings-view__value">{{ fontSize }} px</span>
            </div>
          </el-form-item>

          <el-form-item label="控件大小">
            <el-radio-group
              :model-value="configStore.controlSize"
              @update:model-value="handleSizeChange"
            >
              <el-radio-button
                v-for="opt in sizeOptions"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </el-radio-button>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="">
            <small class="settings-view__tip">
              字体默认使用内置的 Nunito，其余为本机已安装字体（可搜索筛选）。
            </small>
          </el-form-item>
        </el-form>
          </section>
        </el-tab-pane>

        <el-tab-pane label="编辑器" name="editor">
          <!-- 编辑器 -->
          <section class="settings-view__section">
            <h3 class="settings-view__section-title">编辑器</h3>

        <el-form label-width="110px" label-position="right">
          <el-form-item label="编辑器字号">
            <div class="settings-view__slider">
              <el-slider v-model="editorFontSize" :min="12" :max="20" :step="1" show-stops />
              <span class="settings-view__value">{{ editorFontSize }} px</span>
            </div>
          </el-form-item>

          <el-form-item label="编辑器字体">
            <el-select v-model="editorFontFamily" filterable style="width: 100%">
              <el-option
                v-for="opt in fontOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
                :style="{ fontFamily: opt.stack }"
              />
            </el-select>
          </el-form-item>

        </el-form>
      </section>
    </el-tab-pane>

    <el-tab-pane label="SQL" name="sql">
      <!-- SQL 补全与元数据展示 -->
      <section class="settings-view__section">
        <h3 class="settings-view__section-title">SQL 补全</h3>

        <el-form label-width="110px" label-position="right">
          <el-form-item label="提示触发">
            <el-select v-model="sqlTriggerMode" style="width: 100%">
              <el-option
                v-for="opt in SQL_TRIGGER_MODE_OPTIONS"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              >
                <span>{{ opt.label }}</span>
                <small class="settings-view__option-hint">{{ opt.hint }}</small>
              </el-option>
            </el-select>
          </el-form-item>

          <el-form-item label="表名自动别名">
            <el-switch v-model="sqlAutoAlias" />
          </el-form-item>

          <el-form-item label="展示系统库">
            <el-switch v-model="sqlShowSystemDatabases" />
          </el-form-item>

          <el-form-item label="">
            <small class="settings-view__tip">
              提示触发决定 SQL 编辑器何时自动弹出候选（Ctrl+Space 始终可用）；
              表名自动别名会在 FROM / JOIN 之后补一个短别名
              （<code>users</code> → <code>u</code>、<code>order_items</code> → <code>oi</code>），
              候选里同时保留「不加别名」的那条。
            </small>
          </el-form-item>

          <el-form-item label="">
            <small class="settings-view__tip">
              展示系统库：开启后，库选择下拉框与 SQL 补全候选中会列出系统库
              （<code>information_schema</code>、<code>mysql</code>、<code>sys</code> 等）；
              关闭后这些库不再主动列出，但手动写下的 <code>mysql.user</code>
              仍然照常解析（隐藏不等于非法）。
            </small>
          </el-form-item>
        </el-form>
      </section>
    </el-tab-pane>

    <el-tab-pane label="模板" name="template">
      <!-- 模板 -->
      <section class="settings-view__section">
        <h3 class="settings-view__section-title">模板</h3>

        <el-form label-width="110px" label-position="right">
          <el-form-item label="占位符跳转">
            <el-switch v-model="templatePlaceholderTab" />
          </el-form-item>

          <el-form-item label="">
            <small class="settings-view__tip">
              插入块片段（<code v-pre>{{if}}</code> / <code v-pre>{{end}}</code> 骨架）后，
              主光标停在块头条件的占位处，Tab 依次跳到下一个占位、Shift+Tab 反向，
              走完全部占位后按键恢复常规行为。关闭后 Tab 只做缩进。
            </small>
          </el-form-item>
        </el-form>
      </section>
    </el-tab-pane>

    <el-tab-pane label="快捷键" name="shortcuts">
      <section class="settings-view__section settings-view__section--wide">
        <div class="settings-view__section-heading">
          <div>
            <h3 class="settings-view__section-title">快捷键</h3>
            <p>点击输入框后直接按组合键即可录入；留空会恢复初始值，没有初始快捷键的操作默认留空。</p>
          </div>
        </div>
        <el-table :data="SHORTCUTS" class="settings-view__shortcut-table" size="small">
          <el-table-column prop="group" label="页面" width="116" />
          <el-table-column prop="label" label="操作" min-width="155" />
          <el-table-column label="快捷键" min-width="210">
            <template #default="{ row }">
              <el-input :model-value="shortcutConfig[row.id] || row.defaultKey" placeholder="未设置" @keydown="recordShortcut(row.id, $event)" @change="updateShortcut(row.id, $event)" />
            </template>
          </el-table-column>
          <el-table-column prop="defaultKey" label="初始值" width="126" />
          <el-table-column label="" width="70">
            <template #default="{ row }">
              <el-button link type="primary" @click="resetShortcut(row.id)">重置</el-button>
            </template>
          </el-table-column>
        </el-table>
        <small class="settings-view__tip">组合键支持 Ctrl、Alt、Shift 与一个主键；系统保留的快捷键可能由操作系统或浏览器优先处理。</small>
      </section>
    </el-tab-pane>

    <el-tab-pane label="高级" name="advanced">
      <!-- 日志 -->
      <section class="settings-view__section">
        <h3 class="settings-view__section-title">日志</h3>

        <el-form label-width="110px" label-position="right">
          <el-form-item label="保留条数">
            <div class="settings-view__slider">
              <el-slider v-model="logMaxLines" :min="50" :max="1000" :step="50" />
              <span class="settings-view__value">{{ logMaxLines }}</span>
            </div>
          </el-form-item>
        </el-form>
      </section>

      <!-- 元数据缓存 -->
      <section class="settings-view__section settings-view__metadata-card">
        <div class="settings-view__metadata-head">
          <div>
            <h3 class="settings-view__section-title">元数据缓存</h3>
            <p>用于 SQL 补全和悬停说明；库表结构变更后可在此刷新。</p>
          </div>
          <el-button plain @click="clearMetadataCache">清空缓存</el-button>
        </div>
        <div class="settings-view__metadata-stats">
          <div><strong>{{ metadataCache.databases }}</strong><span>数据库</span></div>
          <div><strong>{{ metadataCache.tables }}</strong><span>库表清单</span></div>
          <div><strong>{{ metadataCache.columns }}</strong><span>字段缓存</span></div>
        </div>
        <small class="settings-view__tip">清空只影响本地缓存，不会删除数据库中的对象；下一次补全或悬停时会自动重新读取。</small>
      </section>

      <!-- 重置 -->
      <section class="settings-view__section">
        <h3 class="settings-view__section-title">重置</h3>

        <el-form label-width="110px" label-position="right">
          <el-form-item label="">
            <el-button type="danger" plain @click="resetSettings">
              恢复默认设置
            </el-button>
          </el-form-item>

          <el-form-item label="">
            <small class="settings-view__tip">
              只重置全部配置项（主题、字体、日志、SQL 补全等）；
              数据库连接、SQL 模板、词典与 Tab 工作台都不受影响。
            </small>
          </el-form-item>
        </el-form>
      </section>
    </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  height: 100%;
  overflow: auto;
  padding: 24px clamp(24px, 4vw, 64px) 36px;
  background: radial-gradient(circle at 90% 0%, color-mix(in srgb, var(--brand-color) 10%, transparent), transparent 34%);
}

.settings-view__head {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 1180px;
  margin: 0 auto 22px;
  font-size: var(--app-font-size-lg);
  font-weight: 600;
}

.settings-view__bar {
  width: 3px;
  height: 15px;
  border-radius: 2px;
  background: var(--brand-color);
}

.settings-view__head small {
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
  font-weight: 400;
}

.settings-view__body {
  width: min(100%, 1180px);
  margin: 0 auto;
  min-height: 520px;
  padding: 18px 22px 26px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: color-mix(in srgb, var(--bg-color) 92%, var(--brand-color));
  box-shadow: 0 12px 34px rgb(0 0 0 / 8%);
}

.settings-view__tabs :deep(.el-tabs__nav-wrap::after) { height: 1px; }
.settings-view__tabs :deep(.el-tabs__item) { height: 42px; padding: 0 18px; font-weight: 600; }
.settings-view__tabs :deep(.el-tabs__active-bar) { height: 3px; border-radius: 3px 3px 0 0; }
.settings-view__tabs :deep(.el-tabs__content) { padding: 18px 4px 4px; }

.settings-view__section + .settings-view__section {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px dashed var(--border-color);
}

.settings-view__section { max-width: 840px; padding: 4px 8px; }
.settings-view__section--wide { max-width: none; }
.settings-view__section-heading { display: flex; align-items: flex-start; justify-content: space-between; }
.settings-view__section-heading p { margin: -6px 0 16px; color: var(--text-muted); font-size: var(--app-font-size-sm); }

.settings-view__metadata-card {
  padding: 18px 20px;
  border: 1px solid color-mix(in srgb, var(--brand-color) 24%, var(--border-color));
  border-radius: 12px;
  background: linear-gradient(120deg, color-mix(in srgb, var(--brand-color) 8%, transparent), transparent 55%);
}
.settings-view__metadata-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.settings-view__metadata-head p { margin: -6px 0 18px; color: var(--text-muted); font-size: var(--app-font-size-sm); }
.settings-view__metadata-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
.settings-view__metadata-stats > div { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border-radius: 9px; background: color-mix(in srgb, var(--bg-color) 72%, var(--brand-color)); }
.settings-view__metadata-stats strong { color: var(--brand-color); font-size: calc(var(--app-font-size-lg) + 4px); line-height: 1; }
.settings-view__metadata-stats span { color: var(--text-muted); font-size: var(--app-font-size-xs); }

.settings-view__section-title {
  margin: 0 0 14px;
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
  font-weight: 600;
  letter-spacing: 0.4px;
}

.settings-view__slider {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
}

.settings-view__slider :deep(.el-slider) {
  flex: 1;
}

.settings-view__value {
  flex: 0 0 56px;
  color: var(--text-muted);
  font-size: var(--app-font-size-sm);
  text-align: right;
}

.settings-view__tip {
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
  line-height: 1.6;
}

/* 下拉项里的说明文字：左侧标题 + 灰色注解 */
.settings-view__option-hint {
  margin-left: 8px;
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
}

.settings-view__shortcut-table {
  margin: 8px 0 14px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow: hidden;
}
.settings-view__shortcut-table :deep(.el-input__wrapper) { box-shadow: 0 0 0 1px var(--border-color) inset; }

@media (max-width: 760px) {
  .settings-view { padding: 16px; }
  .settings-view__body { padding: 12px; border-radius: 10px; }
  .settings-view__tabs :deep(.el-tabs__item) { padding: 0 10px; }
  .settings-view__metadata-head { align-items: stretch; flex-direction: column; }
  .settings-view__metadata-stats { grid-template-columns: 1fr; }
}
</style>
