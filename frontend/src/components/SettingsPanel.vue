<script setup lang="ts">
import { computed } from 'vue'
import { useConfigStore } from '@/stores/configStore'
import { useLogStore } from '@/stores/logStore'
import type { ControlSize, ThemeMode } from '@/types'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
}>()

const configStore = useConfigStore()
const logStore = useLogStore()

/** 主题选项 */
const themeOptions: Array<{ label: string, value: ThemeMode }> = [
  { label: '暗色', value: 'dark' },
  { label: '亮色', value: 'light' },
]

/** 控件尺寸选项 */
const sizeOptions: Array<{ label: string, value: ControlSize }> = [
  { label: '大', value: 'large' },
  { label: '默认', value: 'default' },
  { label: '小', value: 'small' },
]

/** 当前字体大小（供滑块双向绑定） */
const fontSize = computed({
  get: () => configStore.fontSize,
  set: (value: number) => configStore.set('font_size', String(value)),
})

/** 编辑器字号 */
const editorFontSize = computed({
  get: () => configStore.editorFontSize,
  set: (value: number) => configStore.set('editor_font_size', String(value)),
})

/** 日志保留条数 */
const logMaxLines = computed({
  get: () => configStore.logMaxLines,
  set: (value: number) => {
    configStore.set('log_max_lines', String(value))
    logStore.setMaxLines(value)
  },
})

/** 主题 */
function handleThemeChange(value: string | number | boolean | undefined) {
  configStore.set('theme', String(value))
}

/** 控件尺寸 */
function handleSizeChange(value: string | number | boolean | undefined) {
  configStore.set('control_size', String(value))
}

/** 双向绑定：仅转发，不在此处产生副作用 */
const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

function close() {
  emit('update:visible', false)
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    title="设置"
    width="520px"
  >
    <el-form label-width="120px" label-position="right">
      <el-form-item label="主题">
        <el-radio-group
          :model-value="configStore.theme"
          @update:model-value="handleThemeChange"
        >
          <el-radio-button
            v-for="opt in themeOptions"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item label="界面字体大小">
        <div class="settings__slider">
          <el-slider v-model="fontSize" :min="12" :max="18" :step="1" show-stops />
          <span class="settings__value">{{ fontSize }} px</span>
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

      <el-form-item label="编辑器字号">
        <div class="settings__slider">
          <el-slider v-model="editorFontSize" :min="12" :max="20" :step="1" show-stops />
          <span class="settings__value">{{ editorFontSize }} px</span>
        </div>
      </el-form-item>

      <el-form-item label="日志保留条数">
        <div class="settings__slider">
          <el-slider v-model="logMaxLines" :min="50" :max="1000" :step="50" />
          <span class="settings__value">{{ logMaxLines }}</span>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <span class="settings__hint">修改会立即生效并自动保存</span>
      <el-button type="primary" @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.settings__slider {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
}

.settings__slider :deep(.el-slider) {
  flex: 1;
}

.settings__value {
  flex: 0 0 56px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: right;
}

.settings__hint {
  margin-right: 12px;
  color: var(--text-muted);
  font-size: 12px;
}
</style>
