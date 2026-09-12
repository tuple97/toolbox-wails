<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useConfigStore } from '@/stores/configStore'
import { useLogStore } from '@/stores/logStore'
import { fetchSystemFonts } from '@/api/fonts'
import { buildFontOptions } from '@/utils/fonts'
import type { ControlSize, ThemeMode } from '@/types'

/**
 * 设置（单例标签页）。
 *
 * 所有修改即时生效并自动保存（configStore 内部有防抖落盘），
 * 因此这里不需要「保存」按钮。
 */

const configStore = useConfigStore()
const logStore = useLogStore()

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

/** 窗口背景透明度（百分比） */
const backgroundAlpha = computed({
  get: () => configStore.backgroundAlpha,
  set: (value: number) => configStore.set('background_alpha', String(value)),
})

/** 窗口背景磨砂半径（px） */
const backgroundBlur = computed({
  get: () => configStore.backgroundBlur,
  set: (value: number) => configStore.set('background_blur', String(value)),
})

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

      <!-- 编辑器与日志 -->
      <section class="settings-view__section">
        <h3 class="settings-view__section-title">编辑器与日志</h3>

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

          <el-form-item label="日志保留条数">
            <div class="settings-view__slider">
              <el-slider v-model="logMaxLines" :min="50" :max="1000" :step="50" />
              <span class="settings-view__value">{{ logMaxLines }}</span>
            </div>
          </el-form-item>

          <el-form-item label="">
            <small class="settings-view__tip">
              编辑器字体独立于界面字体，可单独指定；选项与本机已安装字体同步。
            </small>
          </el-form-item>
        </el-form>
      </section>

      <!-- 窗口背景 -->
      <section class="settings-view__section">
        <h3 class="settings-view__section-title">窗口背景</h3>

        <el-form label-width="110px" label-position="right">
          <el-form-item label="背景透明度">
            <div class="settings-view__slider">
              <el-slider v-model="backgroundAlpha" :min="20" :max="100" :step="1" />
              <span class="settings-view__value">{{ backgroundAlpha }}%</span>
            </div>
          </el-form-item>

          <el-form-item label="背景磨砂">
            <div class="settings-view__slider">
              <el-slider v-model="backgroundBlur" :min="0" :max="40" :step="1" />
              <span class="settings-view__value">{{ backgroundBlur }} px</span>
            </div>
          </el-form-item>

          <el-form-item label="效果预览">
            <div class="settings-view__preview">
              <div class="settings-view__preview-pattern"></div>
              <div class="settings-view__preview-glass"></div>
            </div>
          </el-form-item>

          <el-form-item label="">
            <small class="settings-view__tip">
              透明度越低越能透出桌面，配合磨砂即为毛玻璃效果；100% 为不透明。
            </small>
          </el-form-item>
        </el-form>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  height: 100%;
  overflow: auto;
  padding: 16px 20px;
}

.settings-view__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
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
  max-width: 640px;
}

.settings-view__section + .settings-view__section {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px dashed var(--border-color);
}

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

/* 背景效果实时预览：底纹 + 与实际背景层同参数的效果层 */
.settings-view__preview {
  position: relative;
  width: 100%;
  height: 64px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.settings-view__preview-pattern {
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(45deg, #f97316 0 12px, #0ea5e9 12px 24px),
    linear-gradient(#22c55e, #a855f7);
}

.settings-view__preview-glass {
  position: absolute;
  inset: 0;
  background: rgb(var(--bg-rgb) / var(--app-bg-alpha));
  backdrop-filter: blur(var(--app-bg-blur));
}
</style>
