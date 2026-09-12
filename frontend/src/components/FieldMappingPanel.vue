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
  <div class="tpl-panel-list">
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
    <el-collapse v-else v-model="expandedNames" class="tpl-panel-list__collapse">
      <el-collapse-item
        v-for="(mapping, index) in modelValue"
        :key="mapping.column"
        :name="mapping.column"
      >
        <template #title>
          <div class="tpl-panel__title">
            <code class="tpl-panel__chip">{{ mapping.column }}</code>
            <span class="tpl-panel__title-text">{{ mapping.label || '未设置别名' }}</span>
            <el-tag v-if="mapping.dictionaryId" size="small" type="info" effect="plain">
              词典
            </el-tag>
          </div>
        </template>

        <div
          v-if="expandedNames.includes(mapping.column)"
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
      </el-collapse-item>
    </el-collapse>
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
</style>
