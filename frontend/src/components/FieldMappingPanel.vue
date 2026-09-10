<script setup lang="ts">
import { onMounted } from 'vue'
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

    <div v-for="(mapping, index) in modelValue" :key="mapping.column" class="field-panel__item">
      <div class="field-panel__column">
        <span class="field-panel__name">{{ mapping.column }}</span>
      </div>

      <el-form label-position="top" size="small">
        <el-form-item label="展示别名">
          <el-input
            :model-value="mapping.label"
            placeholder="表格列标题"
            @update:model-value="update(index, { label: $event })"
          />
        </el-form-item>

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
          <el-select
            :model-value="mapping.dictionaryId"
            placeholder="不翻译"
            clearable
            filterable
            style="width: 100%"
            @update:model-value="update(index, { dictionaryId: $event ?? undefined })"
          >
            <el-option
              v-for="dict in dictStore.dictionaries"
              :key="dict.id"
              :label="dict.name"
              :value="dict.id"
            />
          </el-select>
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
  </div>
</template>

<style scoped>
.field-panel {
  padding: 4px 0;
}

.field-panel__item {
  padding: 10px 0;
  border-bottom: 1px dashed var(--border-color);
}

.field-panel__item:last-child {
  border-bottom: none;
}

.field-panel__column {
  margin-bottom: 6px;
}

.field-panel__name {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(56, 189, 248, 0.14);
  color: var(--brand-color);
  font-family: var(--font-mono);
  font-size: 12px;
}

.field-panel__row {
  display: flex;
  gap: 10px;
}

.field-panel__row > * {
  flex: 1;
  min-width: 0;
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
