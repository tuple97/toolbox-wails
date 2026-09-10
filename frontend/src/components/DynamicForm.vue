<script setup lang="ts">
import { onMounted, reactive, watch } from 'vue'
import { fetchVariableOptions } from '@/api/db'
import type { VariableConfig, VariableOption } from '@/types'

const props = defineProps<{
  /** 变量配置列表 */
  configs: VariableConfig[]
  /** 当前连接 ID，用于拉取动态选项 */
  connId: number | null
}>()

const emit = defineEmits<{
  (e: 'change', values: Record<string, unknown>): void
}>()

/** 各变量的当前取值 */
const values = reactive<Record<string, unknown>>({})
/** 动态选项缓存：变量名 → 选项列表 */
const dynamicOptions = reactive<Record<string, VariableOption[]>>({})
/** 动态选项加载状态 */
const loadingOptions = reactive<Record<string, boolean>>({})

/** 应用默认值 */
function applyDefaults() {
  for (const config of props.configs) {
    if (values[config.name] === undefined) {
      values[config.name] = config.defaultValue ?? defaultForType(config)
    }
  }
}

/** 该变量是否使用下拉选项（需要加载选项来源） */
function usesOptions(config: VariableConfig): boolean {
  return config.component === 'select' || config.component === 'multi-select'
}

/**
 * 读取变量当前值。
 *
 * 模板中统一使用 getValue/setValue 而非直接写 v-model="values[name]"：
 *  - 避免在模板里出现 TS 类型断言（断言不是合法的 v-model 赋值目标，
 *    会导致 Vue 的响应式追踪异常并引发持续重渲染）
 *  - 集中处理空值默认值，减少模板分支
 */
function getValue(config: VariableConfig): unknown {
  const current = values[config.name]
  if (current !== undefined) {
    return current
  }
  return defaultForType(config)
}

/** 写入变量值 */
function setValue(config: VariableConfig, value: unknown) {
  values[config.name] = value
  notifyChange()
}

/** 读取字符串值（输入类组件使用） */
function getStringValue(config: VariableConfig): string {
  const current = getValue(config)
  return current === null || current === undefined ? '' : String(current)
}

/** 读取数组值（多选组件使用） */
function getArrayValue(config: VariableConfig): string[] {
  const current = getValue(config)
  return Array.isArray(current) ? (current as string[]) : []
}

/** 读取数字值（滑块使用） */
function getNumberValue(config: VariableConfig): number {
  const current = getValue(config)
  const parsed = Number(current)
  return Number.isFinite(parsed) ? parsed : (config.min ?? 0)
}

/** 读取布尔值（开关使用） */
function getBooleanValue(config: VariableConfig): boolean {
  return Boolean(getValue(config))
}

/** 按数据类型给出合理默认值 */
function defaultForType(config: VariableConfig): unknown {
  switch (config.dataType) {
    case 'int':
    case 'float':
      return config.min ?? 0
    case 'bool':
      return false
    case 'date':
      return ''
    default:
      return config.component === 'multi-select' ? [] : ''
  }
}

/** 拉取动态选项 */
async function loadDynamicOptions(config: VariableConfig) {
  const dynamic = config.dynamicOptions
  if (!dynamic?.sql || !props.connId) {
    return
  }

  loadingOptions[config.name] = true
  try {
    const rows = await fetchVariableOptions(props.connId, dynamic.sql)
    dynamicOptions[config.name] = rows.map((row) => {
      const value = row[dynamic.valueColumn]
      const label = row[dynamic.labelColumn]
      return {
        // 选项值统一转字符串，避免数字与字符串比较失败
        value: value === null || value === undefined ? '' : String(value),
        label: label === null || label === undefined ? String(value ?? '') : String(label),
      }
    })
  }
  catch {
    dynamicOptions[config.name] = []
  }
  finally {
    loadingOptions[config.name] = false
  }
}

/** 取某变量最终可用的选项列表 */
function optionsFor(config: VariableConfig): VariableOption[] {
  return dynamicOptions[config.name] ?? config.options ?? []
}

/** 值变化后通知外部，并把值按数据类型转换 */
function notifyChange() {
  const converted: Record<string, unknown> = {}
  for (const config of props.configs) {
    converted[config.name] = convertValue(values[config.name], config.dataType)
  }
  emit('change', converted)
}

/** 按数据类型转换取值 */
function convertValue(value: unknown, dataType: VariableConfig['dataType']): unknown {
  if (value === null || value === undefined || value === '') {
    return value
  }
  switch (dataType) {
    case 'int': {
      const num = Number.parseInt(String(value), 10)
      return Number.isNaN(num) ? value : num
    }
    case 'float': {
      const num = Number.parseFloat(String(value))
      return Number.isNaN(num) ? value : num
    }
    case 'bool':
      return Boolean(value)
    default:
      return value
  }
}

/** 暴露当前取值，供父组件在查询时读取 */
function getValues(): Record<string, unknown> {
  const converted: Record<string, unknown> = {}
  for (const config of props.configs) {
    converted[config.name] = convertValue(values[config.name], config.dataType)
  }
  return converted
}

defineExpose({ getValues, notifyChange })

onMounted(() => {
  applyDefaults()
  for (const config of props.configs) {
    void loadDynamicOptions(config)
  }
  notifyChange()
})

/** 变量配置发生变化时，补齐默认值并加载新变量的动态选项 */
watch(
  () => props.configs.map(c => c.name).join('|'),
  () => {
    applyDefaults()
    for (const config of props.configs) {
      if (usesOptions(config) && !dynamicOptions[config.name]) {
        void loadDynamicOptions(config)
      }
    }
    notifyChange()
  },
)
</script>

<template>
  <div class="dynamic-form">
    <p v-if="!configs.length" class="dynamic-form__empty">
      模板中未检测到变量。在 SQL 中使用 <code>&#123;&#123; 变量名 &#125;&#125;</code> 即可自动识别。
    </p>

    <el-form v-else label-position="top" size="default">
      <el-form-item
        v-for="config in configs"
        :key="config.name"
        :label="config.label || config.name"
      >
        <!-- 文本输入 -->
        <el-input
          v-if="config.component === 'input'"
          :model-value="getStringValue(config)"
          :placeholder="config.placeholder || `请输入 ${config.label || config.name}`"
          clearable
          @update:model-value="setValue(config, $event)"
        />

        <!-- 多行文本 -->
        <el-input
          v-else-if="config.component === 'textarea'"
          :model-value="getStringValue(config)"
          type="textarea"
          :rows="3"
          :placeholder="config.placeholder"
          @update:model-value="setValue(config, $event)"
        />

        <!-- 单选下拉 -->
        <el-select
          v-else-if="config.component === 'select'"
          :model-value="getStringValue(config)"
          :loading="loadingOptions[config.name]"
          :placeholder="config.placeholder || '请选择'"
          clearable
          filterable
          style="width: 100%"
          @update:model-value="setValue(config, $event)"
        >
          <el-option
            v-for="opt in optionsFor(config)"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>

        <!-- 多选下拉 -->
        <el-select
          v-else-if="config.component === 'multi-select'"
          :model-value="getArrayValue(config)"
          multiple
          collapse-tags
          collapse-tags-tooltip
          :loading="loadingOptions[config.name]"
          :placeholder="config.placeholder || '请选择'"
          style="width: 100%"
          @update:model-value="setValue(config, $event)"
        >
          <el-option
            v-for="opt in optionsFor(config)"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>

        <!-- 日期选择 -->
        <el-date-picker
          v-else-if="config.component === 'date-picker'"
          :model-value="getStringValue(config)"
          type="date"
          value-format="YYYY-MM-DD"
          :placeholder="config.placeholder || '选择日期'"
          style="width: 100%"
          @update:model-value="setValue(config, $event)"
        />

        <!-- 滑块 -->
        <el-slider
          v-else-if="config.component === 'slider'"
          :model-value="getNumberValue(config)"
          :min="config.min ?? 0"
          :max="config.max ?? 100"
          :step="config.step ?? 1"
          show-input
          @update:model-value="setValue(config, $event)"
        />

        <!-- 开关 -->
        <el-switch
          v-else-if="config.component === 'switch'"
          :model-value="getBooleanValue(config)"
          @update:model-value="setValue(config, $event)"
        />

        <!-- 兜底：按普通输入处理 -->
        <el-input
          v-else
          :model-value="getStringValue(config)"
          @update:model-value="setValue(config, $event)"
        />
      </el-form-item>
    </el-form>
  </div>
</template>

<style scoped>
.dynamic-form {
  padding: 4px 0;
}

.dynamic-form__empty {
  margin: 0;
  padding: 16px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.7;
}

.dynamic-form__empty code {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(56, 189, 248, 0.12);
  color: var(--brand-color);
  font-family: var(--font-mono);
}

.dynamic-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.dynamic-form :deep(.el-form-item__label) {
  padding-bottom: 4px;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
