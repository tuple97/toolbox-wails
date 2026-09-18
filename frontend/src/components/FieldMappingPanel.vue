<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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

/** 主从布局：默认选择第一列，列表刷新后保留仍然存在的选中项。 */
const selectedName = ref('')
watch(() => props.modelValue, (items) => {
  if (!items.some(item => item.column === selectedName.value)) {
    selectedName.value = items[0]?.column ?? ''
  }
}, { immediate: true, deep: false })
function selectMapping(column: string) {
  selectedName.value = column
}

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
  <div class="tpl-panel-list">
    <el-empty
      v-if="!modelValue.length"
      description="执行查询后会自动列出结果列"
      :image-size="60"
    />

    <div v-else class="tpl-master">
      <aside class="tpl-master__list" aria-label="字段列表">
        <button
          v-for="mapping in modelValue"
          :key="mapping.column"
          type="button"
          class="tpl-master__item"
          :class="{ 'is-active': mapping.column === selectedName }"
          @click="selectMapping(mapping.column)"
        >
          <code>{{ mapping.column }}</code>
          <el-tag v-if="mapping.dictionaryId" size="small" type="info" effect="plain">词典</el-tag>
          <span>{{ mapping.label || '未设置别名' }}</span>
        </button>
      </aside>
      <div class="tpl-master__detail">
      <div
        v-for="(mapping, index) in modelValue"
        :key="mapping.column"
        v-show="mapping.column === selectedName"
        class="tpl-master__detail-item"
      >
        <div
          v-if="mapping.column === selectedName"
          v-memo="[mapping, dictOptions]"
        >
          <el-form class="tpl-panel__form" label-position="left" label-width="76px" size="small">
            <!-- 列信息与展示 -->
            <section class="tpl-panel__group">
              <div class="tpl-panel__group-title">展示设置</div>
              <div class="tpl-panel__grid">
                <el-form-item label="展示别名">
                  <el-input
                    :model-value="mapping.label"
                    placeholder="表格列标题，留空用列名"
                    @update:model-value="update(index, { label: $event })"
                  />
                </el-form-item>

                <el-form-item label="列宽">
                  <el-input-number
                    :model-value="mapping.width"
                    :min="0"
                    controls-position="right"
                    placeholder="自适应"
                    style="width: 100%"
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
            </section>

            <!-- 词典翻译 -->
            <section class="tpl-panel__group">
              <div class="tpl-panel__group-title">词典翻译</div>
              <div class="tpl-panel__grid">
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
              </div>
            </section>
          </el-form>
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

.tpl-panel-list :deep(.el-collapse-item__header) {
  font-size: var(--app-font-size);
}

.tpl-master { display: grid; grid-template-columns: minmax(180px, 26%) minmax(0, 1fr); min-height: 300px; border: 1px solid var(--border-color); border-radius: 12px; overflow: hidden; background: color-mix(in srgb, var(--bg-color) 88%, var(--brand-color)); }
.tpl-master__list { display: flex; flex-direction: column; margin: 0; padding: 4px 0; border-right: 1px solid var(--border-color); background: var(--bg-color-soft); overflow: auto; }
.tpl-master__item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 8px; width: 100%; padding: 10px 12px; border: 0; border-radius: 0; color: var(--text-color); background: transparent; text-align: left; cursor: pointer; }
.tpl-master__item:hover { background: var(--hover-bg); }
.tpl-master__item.is-active { background: var(--active-bg); box-shadow: inset 3px 0 0 var(--brand-color); }
.tpl-master__item code { color: var(--brand-color); font-family: var(--font-mono); font-size: var(--app-font-size-sm); }
.tpl-master__item span { grid-column: 1 / -1; overflow: hidden; color: var(--text-muted); font-size: var(--app-font-size-xs); text-overflow: ellipsis; white-space: nowrap; }
.tpl-master__detail { min-width: 0; padding: 16px 18px; overflow: auto; }
@media (max-width: 720px) { .tpl-master { grid-template-columns: 1fr; } .tpl-master__list { max-height: 150px; border-right: 0; border-bottom: 1px solid var(--border-color); } }
</style>
