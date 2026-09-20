<script setup lang="ts">
import { onMounted, reactive, watch } from 'vue'
import Combobox from '@/components/ui/Combobox.vue'
import DateInput from '@/components/ui/DateInput.vue'
import Input from '@/components/ui/Input.vue'
import MultiSelect from '@/components/ui/MultiSelect.vue'
import Slider from '@/components/ui/Slider.vue'
import Switch from '@/components/ui/Switch.vue'
import { cn } from '@/lib/utils'
import { fetchVariableOptions } from '@/api/db'
import type { VariableConfig, VariableOption } from '@/types'

const props = withDefaults(defineProps<{
  /** 变量配置列表 */
  configs: VariableConfig[]
  /** 当前连接 ID，用于拉取动态选项 */
  connId: number | null
  /**
   * 多个变量是否横向排布。
   * 查询页的条件区位于结果区上方，横向排布更省垂直空间。
   */
  inline?: boolean
}>(), {
  inline: false,
})

const emit = defineEmits<{
  (e: 'change', values: Record<string, unknown>): void
  /**
   * 条件区按下回车。
   * 单行输入框在 <form> 内回车会触发原生提交，若不拦截会导致整页重载，
   * 因此统一在表单上 preventDefault 后，把回车转成「执行查询」交给父组件。
   */
  (e: 'submit'): void
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

/**
 * 是否占用整行。
 * 多行文本与滑块（带输入框）横向空间需求大，放进网格单列会很局促，
 * 因此让它们横跨整行。
 */
function isFullWidthItem(config: VariableConfig): boolean {
  return config.component === 'textarea' || config.component === 'slider'
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
  <div class="dynamic-form py-1">
    <p v-if="!configs.length" class="dynamic-form__empty">
      模板中未检测到变量。在 SQL 中使用 <code>&#123;&#123; 变量名 &#125;&#125;</code> 即可自动识别。
    </p>

    <!--
      横向模式（查询页的条件区）：条件名与控件同一行，两者作为整体参与换行，
      避免条件名与控件被拆到两行；网格 300px 起步，窗口越宽列数越多。
    -->
    <form
      v-else
      :class="inline
        ? 'grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-center gap-x-4.5 gap-y-2.5'
        : 'flex flex-col gap-3'"
      @submit.prevent="emit('submit')"
    >
      <div
        v-for="config in configs"
        :key="config.name"
        :class="cn(
          inline ? 'flex items-center gap-2' : 'flex flex-col gap-1',
          // 多行文本与滑块横向需求大，放进网格单列会很局促，横跨整行
          inline && isFullWidthItem(config) && 'col-span-full',
        )"
      >
        <label
          :class="cn(
            'text-sm text-muted',
            inline ? 'w-24 shrink-0 truncate text-right' : 'w-auto',
          )"
        >
          {{ config.label || config.name }}
        </label>

        <div class="min-w-0 flex-1">
          <!-- 文本输入 -->
          <Input
            v-if="config.component === 'input'"
            :model-value="getStringValue(config)"
            :placeholder="config.placeholder || `请输入 ${config.label || config.name}`"
            clearable
            @update:model-value="setValue(config, $event)"
          />

          <!-- 多行文本 -->
          <Input
            v-else-if="config.component === 'textarea'"
            :model-value="getStringValue(config)"
            type="textarea"
            :rows="3"
            :placeholder="config.placeholder"
            @update:model-value="setValue(config, $event)"
          />

          <!-- 单选下拉（动态选项尚在读取时用占位文案说明，而不是静默的空列表） -->
          <Combobox
            v-else-if="config.component === 'select'"
            :model-value="getStringValue(config)"
            :options="optionsFor(config)"
            :placeholder="loadingOptions[config.name]
              ? '正在读取选项…'
              : (config.placeholder || '请选择')"
            clearable
            @update:model-value="setValue(config, $event)"
          />

          <!-- 多选下拉 -->
          <MultiSelect
            v-else-if="config.component === 'multi-select'"
            :model-value="getArrayValue(config)"
            :options="optionsFor(config)"
            :placeholder="loadingOptions[config.name] ? '正在读取选项…' : (config.placeholder || '请选择')"
            @update:model-value="setValue(config, $event)"
          />

          <!-- 日期选择（原生 date 的值格式就是 YYYY-MM-DD，与旧 value-format 一致） -->
          <DateInput
            v-else-if="config.component === 'date-picker'"
            :model-value="getStringValue(config)"
            @update:model-value="setValue(config, $event)"
          />

          <!-- 滑块：数值文本由这里渲染（EP 的 show-input 位置） -->
          <div v-else-if="config.component === 'slider'" class="flex items-center gap-3">
            <Slider
              :model-value="getNumberValue(config)"
              :min="config.min ?? 0"
              :max="config.max ?? 100"
              :step="config.step ?? 1"
              class="flex-1"
              @update:model-value="setValue(config, $event)"
            />
            <span class="w-12 shrink-0 text-right text-sm text-muted">
              {{ getNumberValue(config) }}
            </span>
          </div>

          <!-- 开关 -->
          <Switch
            v-else-if="config.component === 'switch'"
            :model-value="getBooleanValue(config)"
            @update:model-value="setValue(config, $event)"
          />

          <!-- 兜底：按普通输入处理 -->
          <Input
            v-else
            :model-value="getStringValue(config)"
            @update:model-value="setValue(config, $event)"
          />
        </div>
      </div>
    </form>
  </div>
</template>

<style scoped>
/*
 * 只剩「未检测到变量」这条提示还需要样式：它是带虚线框的说明块，
 * 用 Tailwind 写会很长且与语义无关，留在 scoped 里更好读。
 * 其余版面（网格 / 标签对齐 / 横跨整行）都在模板里用工具类表达。
 */
.dynamic-form__empty {
  margin: 0;
  padding: 18px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  background: var(--surface-color);
  color: var(--text-muted);
  font-size: var(--app-font-size-sm);
  line-height: 1.7;
  text-align: center;
}

.dynamic-form__empty code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--active-bg);
  color: var(--brand-color);
  font-family: var(--font-mono);
}
</style>
