<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { fetchVariableOptions } from '@/api/db'
import type { VariableComponent, VariableConfig, VariableDataType, VariableOption } from '@/types'

const props = defineProps<{
  /** 变量配置列表 */
  modelValue: VariableConfig[]
  /** 当前连接 ID，动态选项需要 */
  connId: number | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: VariableConfig[]): void
}>()

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

/** 测试动态选项 SQL 是否能正确返回数据 */
async function testDynamicOptions(config: VariableConfig) {
  if (!props.connId) {
    ElMessage.warning('请先在工具栏选择数据库连接')
    return
  }
  const dynamic = config.dynamicOptions
  if (!dynamic?.sql.trim()) {
    ElMessage.warning('请填写选项查询 SQL')
    return
  }

  try {
    const rows = await fetchVariableOptions(props.connId, dynamic.sql)
    if (rows.length === 0) {
      ElMessage.warning('查询成功，但未返回任何数据')
      return
    }
    ElMessage.success(`查询成功，共 ${rows.length} 条选项`)
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
}
</script>

<template>
  <div class="var-panel">
    <el-empty
      v-if="!modelValue.length"
      description="暂无变量，在 SQL 中使用 {{ 变量名 }} 会自动识别"
      :image-size="60"
    />

    <el-collapse v-else>
      <el-collapse-item
        v-for="(config, index) in modelValue"
        :key="config.name"
        :name="config.name"
      >
        <template #title>
          <span class="var-panel__title">{{ config.label || config.name }}</span>
          <el-tag size="small" type="info" effect="plain">
            {{ config.component }}
          </el-tag>
        </template>

        <el-form label-position="left" label-width="70px" size="small">
          <el-form-item label="变量名">
            <el-input :model-value="config.name" disabled />
          </el-form-item>

          <el-form-item label="展示名称">
            <el-input
              :model-value="config.label"
              placeholder="界面上的标签"
              @update:model-value="update(index, { label: $event })"
            />
          </el-form-item>

          <el-form-item label="组件类型">
            <el-select
              :model-value="config.component"
              style="width: 100%"
              @update:model-value="update(index, { component: $event })"
            >
              <el-option
                v-for="item in COMPONENTS"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="数据类型">
            <el-select
              :model-value="config.dataType"
              style="width: 100%"
              @update:model-value="update(index, { dataType: $event })"
            >
              <el-option
                v-for="item in DATA_TYPES"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
          </el-form-item>

          <!-- 滑块范围 -->
          <template v-if="usesRange(config.component)">
            <el-form-item label="最小值">
              <el-input-number
                :model-value="config.min ?? 0"
                controls-position="right"
                @update:model-value="update(index, { min: $event ?? 0 })"
              />
            </el-form-item>
            <el-form-item label="最大值">
              <el-input-number
                :model-value="config.max ?? 100"
                controls-position="right"
                @update:model-value="update(index, { max: $event ?? 100 })"
              />
            </el-form-item>
          </template>

          <!-- 下拉选项配置 -->
          <template v-if="usesOptions(config.component)">
            <el-form-item label="选项来源">
              <el-radio-group
                :model-value="optionsMode(config)"
                @update:model-value="handleSourceChange(index, config, $event as string)"
              >
                <el-radio-button value="static">静态配置</el-radio-button>
                <el-radio-button value="dynamic">SQL 动态获取</el-radio-button>
              </el-radio-group>
            </el-form-item>

            <!-- 静态选项 -->
            <template v-if="optionsMode(config) === 'static'">
              <div
                v-for="(opt, optIndex) in config.options ?? []"
                :key="optIndex"
                class="var-panel__option"
              >
                <el-input
                  :model-value="opt.label"
                  placeholder="显示文本"
                  @update:model-value="updateOption(index, config, optIndex, { label: $event })"
                />
                <el-input
                  :model-value="opt.value"
                  placeholder="实际值"
                  @update:model-value="updateOption(index, config, optIndex, { value: $event })"
                />
                <el-button
                  link
                  type="danger"
                  @click="removeOption(index, config, optIndex)"
                >
                  删除
                </el-button>
              </div>
              <el-button link type="primary" @click="addOption(index, config)">
                添加选项
              </el-button>
            </template>

            <!-- 动态选项 -->
            <template v-else>
              <el-form-item label="查询 SQL">
                <el-input
                  :model-value="config.dynamicOptions?.sql ?? ''"
                  type="textarea"
                  :rows="3"
                  placeholder="SELECT status AS value, status_name AS label FROM dict"
                  @update:model-value="update(index, {
                    dynamicOptions: {
                      sql: $event,
                      valueColumn: config.dynamicOptions?.valueColumn ?? 'value',
                      labelColumn: config.dynamicOptions?.labelColumn ?? 'label',
                    },
                  })"
                />
              </el-form-item>

              <el-form-item label="值列名">
                <el-input
                  :model-value="config.dynamicOptions?.valueColumn ?? ''"
                  @update:model-value="update(index, {
                    dynamicOptions: {
                      sql: config.dynamicOptions?.sql ?? '',
                      valueColumn: $event,
                      labelColumn: config.dynamicOptions?.labelColumn ?? 'label',
                    },
                  })"
                />
              </el-form-item>

              <el-form-item label="文本列名">
                <el-input
                  :model-value="config.dynamicOptions?.labelColumn ?? ''"
                  @update:model-value="update(index, {
                    dynamicOptions: {
                      sql: config.dynamicOptions?.sql ?? '',
                      valueColumn: config.dynamicOptions?.valueColumn ?? 'value',
                      labelColumn: $event,
                    },
                  })"
                />
              </el-form-item>

              <el-button link type="primary" @click="testDynamicOptions(config)">
                测试查询
              </el-button>
            </template>
          </template>
        </el-form>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<style scoped>
.var-panel {
  padding: 4px 0;
}

.var-panel__title {
  margin-right: 8px;
  font-size: 13px;
  font-weight: 600;
}

.var-panel__option {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.var-panel :deep(.el-collapse-item__header) {
  font-size: 13px;
  height: 40px;
  line-height: 40px;
}

.var-panel :deep(.el-form-item) {
  margin-bottom: 10px;
}

.var-panel :deep(.el-form-item__label) {
  padding-bottom: 2px;
  font-size: 12px;
  line-height: 1.4;
}
</style>
