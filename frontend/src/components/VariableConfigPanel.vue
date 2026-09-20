<script setup lang="ts">
import { notify } from '@/utils/notify'
import { ref, watch } from 'vue'
import Button from '@/components/ui/Button.vue'
import Combobox from '@/components/ui/Combobox.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Field from '@/components/ui/Field.vue'
import Input from '@/components/ui/Input.vue'
import NumberInput from '@/components/ui/NumberInput.vue'
import Tabs from '@/components/ui/Tabs.vue'
import { fetchVariableOptions } from '@/api/db'
import type { VariableComponent, VariableConfig, VariableDataType, VariableOption } from '@/types'

const props = defineProps<{
  /** 变量配置列表 */
  modelValue: VariableConfig[]
  /** 当前连接 ID */
  connId: number | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: VariableConfig[]): void
}>()

/** 主从布局的选中项 */
const selectedName = ref('')
watch(() => props.modelValue, (items) => {
  if (!items.some(item => item.name === selectedName.value)) {
    selectedName.value = items[0]?.name ?? ''
  }
}, { immediate: true, deep: false })
function selectConfig(name: string) {
  selectedName.value = name
}

/** 可选组件类型 */
const COMPONENTS: Array<{ value: VariableComponent, label: string }> = [
  { value: 'input', label: '单行文本' },
  { value: 'textarea', label: '多行文本' },
  { value: 'select', label: '下拉单选' },
  { value: 'multi-select', label: '下拉多选' },
  { value: 'date-picker', label: '日期选择' },
  { value: 'slider', label: '滑块' },
  { value: 'switch', label: '开关' },
]

/** 可选数据类型 */
const DATA_TYPES: Array<{ value: VariableDataType, label: string }> = [
  { value: 'string', label: '字符串' },
  { value: 'int', label: '整数' },
  { value: 'float', label: '小数' },
  { value: 'bool', label: '布尔' },
  { value: 'date', label: '日期' },
]

/** 选项来源 */
const SOURCE_MODES = [
  { value: 'static', label: '静态配置' },
  { value: 'dynamic', label: 'SQL 动态获取' },
]

/** 组件类型的中文名 */
function componentLabel(component: VariableComponent): string {
  return COMPONENTS.find(item => item.value === component)?.label ?? component
}

/** 选项相关的组件类型 */
function usesOptions(component: VariableComponent): boolean {
  return component === 'select' || component === 'multi-select'
}

/** 需要数字范围的组件 */
function usesRange(component: VariableComponent): boolean {
  return component === 'slider'
}

/** 更新某一项配置 */
function update(index: number, patch: Partial<VariableConfig>) {
  const next = props.modelValue.map((item, i) =>
    i === index ? { ...item, ...patch } : item,
  )
  emit('update:modelValue', next)
}

/** 切换选项来源模式时的清理 */
function handleSourceChange(index: number, config: VariableConfig, mode: string) {
  if (mode === 'static') {
    update(index, { dynamicOptions: undefined, options: config.options ?? [] })
    return
  }
  update(index, {
    options: undefined,
    dynamicOptions: config.dynamicOptions ?? {
      sql: '',
      valueColumn: 'value',
      labelColumn: 'label',
    },
  })
}

/** 判断当前是静态还是动态选项 */
function optionsMode(config: VariableConfig): 'static' | 'dynamic' {
  return config.dynamicOptions ? 'dynamic' : 'static'
}

/** 只改动态选项里的某一个字段 */
function updateDynamicOption(
  index: number,
  config: VariableConfig,
  patch: Partial<NonNullable<VariableConfig['dynamicOptions']>>,
) {
  const current = config.dynamicOptions ?? { sql: '', valueColumn: 'value', labelColumn: 'label' }
  update(index, { dynamicOptions: { ...current, ...patch } })
}

/** 新增静态选项 */
function addOption(index: number, config: VariableConfig) {
  const options = [...(config.options ?? []), { label: '', value: '' } as VariableOption]
  update(index, { options })
}

/** 修改静态选项 */
function updateOption(
  index: number,
  config: VariableConfig,
  optionIndex: number,
  patch: Partial<VariableOption>,
) {
  const options = (config.options ?? []).map((opt, i) =>
    i === optionIndex ? { ...opt, ...patch } : opt,
  )
  update(index, { options })
}

/** 删除静态选项 */
function removeOption(index: number, config: VariableConfig, optionIndex: number) {
  const options = (config.options ?? []).filter((_, i) => i !== optionIndex)
  update(index, { options })
}

/** 测试动态选项 SQL */
async function testDynamicOptions(config: VariableConfig) {
  if (!props.connId) {
    notify.warning('请先在工具栏选择数据库连接')
    return
  }
  const dynamic = config.dynamicOptions
  if (!dynamic?.sql.trim()) {
    notify.warning('请填写选项查询 SQL')
    return
  }

  try {
    const rows = await fetchVariableOptions(props.connId, dynamic.sql)
    if (rows.length === 0) {
      notify.warning('查询成功，但未返回任何数据')
      return
    }
    notify.success(`查询成功，共 ${rows.length} 条选项`)
  }
  catch (e) {
    notify.error(e instanceof Error ? e.message : String(e))
  }
}
</script>

<template>
  <div class="tpl-panel-list">
    <EmptyState v-if="!modelValue.length" description="暂无变量" />

    <div v-else class="tpl-master">
      <aside class="tpl-master__list" aria-label="变量列表">
        <button v-for="config in modelValue" :key="config.name" type="button" class="tpl-master__item"
          :class="{ 'is-active': config.name === selectedName }" @click="selectConfig(config.name)">
          <code>{{ config.name }}</code>
          <span>{{ config.label || '未设置展示名称' }}</span>
          <small>{{ componentLabel(config.component) }}</small>
        </button>
      </aside>
      <div class="tpl-master__detail">
        <div v-for="(config, index) in modelValue" :key="config.name" v-show="config.name === selectedName"
          class="tpl-master__detail-item">
          <div class="tpl-panel__form">
            <section class="tpl-panel__group">
              <div class="tpl-panel__grid">
                <Field label="展示名称" label-width="76px">
                  <Input :model-value="config.label" placeholder="界面上的标签"
                    @update:model-value="update(index, { label: $event })" />
                </Field>

                <Field label="组件类型" label-width="76px">
                  <Combobox :model-value="config.component" :options="COMPONENTS"
                    @update:model-value="update(index, { component: $event as VariableComponent })" />
                </Field>

                <Field label="数据类型" label-width="76px">
                  <Combobox :model-value="config.dataType" :options="DATA_TYPES"
                    @update:model-value="update(index, { dataType: $event as VariableDataType })" />
                </Field>
              </div>
            </section>

            <section v-if="usesRange(config.component)" class="tpl-panel__group">
              <div class="tpl-panel__group-title">取值范围</div>
              <div class="tpl-panel__grid">
                <Field label="最小值" label-width="76px">
                  <NumberInput :model-value="config.min ?? 0" @update:model-value="update(index, { min: $event })" />
                </Field>

                <Field label="最大值" label-width="76px">
                  <NumberInput :model-value="config.max ?? 100" @update:model-value="update(index, { max: $event })" />
                </Field>
              </div>
            </section>

            <section v-if="usesOptions(config.component)" class="tpl-panel__group">
              <div class="tpl-panel__group-title">下拉选项</div>

              <Field label="选项来源" label-width="76px">
                <Tabs :model-value="optionsMode(config)" :items="SOURCE_MODES"
                  @update:model-value="handleSourceChange(index, config, $event)" />
              </Field>

              <!-- 静态选项 -->
              <template v-if="optionsMode(config) === 'static'">
                <div class="tpl-panel__options mt-2.5">
                  <div v-for="(opt, optIndex) in config.options ?? []" :key="optIndex" class="tpl-panel__option-row">
                    <Input :model-value="opt.label" placeholder="显示文本"
                      @update:model-value="updateOption(index, config, optIndex, { label: $event })" />
                    <Input :model-value="opt.value" placeholder="实际值"
                      @update:model-value="updateOption(index, config, optIndex, { value: $event })" />
                    <Button variant="ghost" size="sm" class="shrink-0 text-danger"
                      @click="removeOption(index, config, optIndex)">
                      删除
                    </Button>
                  </div>
                </div>

                <div class="tpl-panel__actions">
                  <Button variant="ghost" size="sm" class="text-brand" @click="addOption(index, config)">
                    ＋ 添加选项
                  </Button>
                </div>
              </template>

              <!-- 动态选项 -->
              <template v-else>
                <Field label="查询 SQL" label-width="76px">
                  <Input :model-value="config.dynamicOptions?.sql ?? ''" type="textarea" :rows="3"
                    placeholder="SELECT status AS value, status_name AS label FROM dict"
                    @update:model-value="updateDynamicOption(index, config, { sql: $event })" />
                </Field>

                <div class="tpl-panel__grid">
                  <Field label="值列名" label-width="76px">
                    <Input :model-value="config.dynamicOptions?.valueColumn ?? ''"
                      @update:model-value="updateDynamicOption(index, config, { valueColumn: $event })" />
                  </Field>

                  <Field label="文本列名" label-width="76px">
                    <Input :model-value="config.dynamicOptions?.labelColumn ?? ''"
                      @update:model-value="updateDynamicOption(index, config, { labelColumn: $event })" />
                  </Field>
                </div>

                <div class="tpl-panel__actions">
                  <Button variant="ghost" size="sm" class="text-brand" @click="testDynamicOptions(config)">
                    测试查询
                  </Button>
                </div>
              </template>
            </section>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 具体排版规范见 styles/template-panels.css，这里只保留面板级微调 */
.tpl-panel-list {
  padding: 2px 0;
}

.tpl-master {
  display: grid;
  grid-template-columns: minmax(180px, 26%) minmax(0, 1fr);
  min-height: 300px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
  background: color-mix(in srgb, var(--bg-color) 88%, var(--brand-color));
}

.tpl-master__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 4px 0;
  border-right: 1px solid var(--border-color);
  background: var(--bg-color-soft);
  overflow: auto;
}

.tpl-master__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 8px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-radius: 0;
  color: var(--text-color);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.tpl-master__item:hover {
  background: var(--hover-bg);
}

.tpl-master__item.is-active {
  background: var(--active-bg);
  box-shadow: inset 3px 0 0 var(--brand-color);
}

.tpl-master__item code {
  color: var(--brand-color);
  font-family: var(--font-mono);
  font-size: var(--app-font-size-sm);
}

.tpl-master__item span {
  grid-column: 1 / -1;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tpl-master__item small {
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
}

.tpl-master__detail {
  min-width: 0;
  padding: 16px 18px;
  overflow: auto;
}

@media (max-width: 720px) {
  .tpl-master {
    grid-template-columns: 1fr;
  }

  .tpl-master__list {
    max-height: 150px;
    border-right: 0;
    border-bottom: 1px solid var(--border-color);
  }
}
</style>
