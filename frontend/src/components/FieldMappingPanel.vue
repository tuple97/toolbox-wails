<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDictStore } from '@/stores/dictStore'
import type { FieldMapping } from '@/types'

const props = defineProps<{
  /** 字段映射配置列表 */
  modelValue: FieldMapping[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: FieldMapping[]): void
}>()

const dictStore = useDictStore()

/** 当前展开的列（收起时不渲染行内细节，字段多时保持轻量） */
const expandedNames = ref<string[]>([])

/** el-select-v2 的选项数据（纯数据传入，避免每行渲染完整选项节点树） */
const dictOptions = computed(() =>
  dictStore.dictionaries.map(dict => ({ label: dict.name, value: dict.id })),
)

/** 更新某一列的映射 */
function update(index: number, patch: Partial<FieldMapping>) {
  const next = props.modelValue.map((item, i) =>
    i === index ? { ...item, ...patch } : item,
  )
  emit('update:modelValue', next)
}

onMounted(() => {
  // 词典用于「翻译列」下拉，未加载时补齐
  if (!dictStore.loaded) {
    void dictStore.loadAll()
  }
})
</script>

<template>
  <div class="field-panel">
    <el-empty
      v-if="!modelValue.length"
      description="执行查询后会自动列出结果列"
      :image-size="60"
    />

    <!--
      与变量配置面板一致的手风琴交互：收起时只显示列名一行。
      v-memo：mapping 对象引用与词典数据都没变时整行跳过 patch
      （父组件赋值时会复用未变化的 mapping 对象，引用相等才能命中缓存）。
    -->
    <el-collapse v-model="expandedNames">
      <el-collapse-item
        v-for="(mapping, index) in modelValue"
        :key="mapping.column"
        :name="mapping.column"
      >
        <template #title>
          <code class="field-panel__name">{{ mapping.column }}</code>
          <span v-if="mapping.label" class="field-panel__alias-hint">{{ mapping.label }}</span>
          <el-tag v-if="mapping.dictionaryId" size="small" type="info" effect="plain">
            词典
          </el-tag>
        </template>

        <div
          v-if="expandedNames.includes(mapping.column)"
          v-memo="[mapping, dictOptions]"
          class="field-panel__detail"
        >
          <!-- 列名与展示别名平行在同一行 -->
          <div class="field-panel__alias-row">
            <code class="field-panel__name">{{ mapping.column }}</code>
            <el-input
              :model-value="mapping.label"
              placeholder="展示别名（表格列标题）"
              @update:model-value="update(index, { label: $event })"
            />
          </div>

          <el-form label-position="left" label-width="70px" size="small">
            <div class="field-panel__row">
              <el-form-item label="列宽">
                <el-input-number
                  :model-value="mapping.width"
                  :min="0"
                  controls-position="right"
                  placeholder="自适应"
                  @update:model-value="update(index, { width: $event ?? undefined })"
                />
              </el-form-item>

              <el-form-item label="对齐">
                <el-select
                  :model-value="mapping.align ?? 'left'"
                  style="width: 100%"
                  @update:model-value="update(index, { align: $event as FieldMapping['align'] })"
                >
                  <el-option label="左对齐" value="left" />
                  <el-option label="居中" value="center" />
                  <el-option label="右对齐" value="right" />
                </el-select>
              </el-form-item>
            </div>

            <el-form-item label="绑定词典">
              <!-- 虚拟滚动下拉：词典多时不会为每行渲染完整选项列表 -->
              <el-select-v2
                :model-value="mapping.dictionaryId"
                :options="dictOptions"
                placeholder="不翻译"
                clearable
                filterable
                style="width: 100%"
                @update:model-value="update(index, { dictionaryId: $event ?? undefined })"
              />
            </el-form-item>

            <el-form-item v-if="mapping.dictionaryId" label="展示模板">
              <el-input
                :model-value="mapping.template ?? ''"
                placeholder="留空显示释义，例：&#123;&#123;value&#125;&#125; - &#123;&#123;meaning&#125;&#125;"
                @update:model-value="update(index, { template: $event })"
              />
            </el-form-item>
          </el-form>
        </div>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<style scoped>
.field-panel {
  padding: 4px 0;
}

/* 收起态标题：列名 + 别名提示 + 词典标记 */
.field-panel__name {
  display: inline-block;
  margin-right: 8px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(56, 189, 248, 0.14);
  color: var(--brand-color);
  font-family: var(--font-mono);
  font-size: 12px;
}

.field-panel__alias-hint {
  margin-right: 8px;
  color: var(--text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 展开态：列名与展示别名输入框平行同一行 */
.field-panel__alias-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.field-panel__alias-row > .field-panel__name {
  flex: 0 0 auto;
  margin-right: 0;
}

.field-panel__alias-row > .el-input {
  flex: 1;
  min-width: 0;
}

.field-panel__row {
  display: flex;
  gap: 10px;
}

.field-panel__row > * {
  flex: 1;
  min-width: 0;
}

.field-panel :deep(.el-collapse-item__header) {
  height: 36px;
  line-height: 36px;
  font-size: 12px;
}

.field-panel :deep(.el-form-item) {
  margin-bottom: 8px;
}

.field-panel :deep(.el-form-item__label) {
  padding-bottom: 2px;
  font-size: 12px;
  line-height: 1.4;
}
</style>
