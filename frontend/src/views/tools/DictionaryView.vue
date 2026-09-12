<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  fetchDictionaries,
  fetchDictionaryItems,
  persistDictionary,
  persistDictionaryItems,
  removeDictionary,
} from '@/api/dictionaries'
import { useDictStore } from '@/stores/dictStore'
import type { Dictionary, DictionaryItem } from '@/types'

/**
 * 词典管理（单例标签页）。
 *
 * 用途：查询结果的「字段映射 → 绑定词典」用它把原始值翻译成可读文本
 * （如 status=1 → 启用）。这里维护词典与其条目。
 *
 * 保存策略：条目为**全量保存**（后端的 SaveDictionaryItems 语义），
 * 因此本地维护草稿列表，点击保存时整体提交。
 */

const dictStore = useDictStore()

const emit = defineEmits<{
  /** 首次加载完成（父级据此关闭 loading 遮罩） */
  (e: 'ready'): void
}>()

/** 词典列表 */
const dictionaries = ref<Dictionary[]>([])
const loading = ref(false)
const saving = ref(false)
const itemsLoading = ref(false)

/** 当前选中的词典 ID */
const selectedId = ref<number | null>(null)
/** 当前词典的条目草稿 */
const draftItems = ref<DictionaryItem[]>([])

/** 编辑词典的弹窗 */
const dictDialogVisible = ref(false)
const dictForm = reactive<Dictionary>({ id: 0, name: '', description: '' })

/** 当前选中的词典 */
const selectedDictionary = computed(
  () => dictionaries.value.find(item => item.id === selectedId.value) ?? null,
)

// ------------------------------------------------------------ 加载

async function loadDictionaries(keepSelection = true) {
  loading.value = true
  try {
    dictionaries.value = await fetchDictionaries()
    if (!keepSelection || !dictionaries.value.some(item => item.id === selectedId.value)) {
      selectedId.value = dictionaries.value[0]?.id ?? null
    }
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
  finally {
    loading.value = false
  }
}

/** 载入选中词典的条目 */
async function loadItems() {
  if (!selectedId.value) {
    draftItems.value = []
    return
  }
  itemsLoading.value = true
  try {
    draftItems.value = await fetchDictionaryItems(selectedId.value)
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
    draftItems.value = []
  }
  finally {
    itemsLoading.value = false
  }
}

/** 切换词典 */
async function handleSelect(id: number) {
  if (selectedId.value === id) {
    return
  }
  selectedId.value = id
  await loadItems()
}

// ------------------------------------------------------------ 词典增删改

function openCreateDictionary() {
  Object.assign(dictForm, { id: 0, name: '', description: '' })
  dictDialogVisible.value = true
}

function openEditDictionary(dict: Dictionary) {
  Object.assign(dictForm, { ...dict })
  dictDialogVisible.value = true
}

async function handleSaveDictionary() {
  if (!dictForm.name.trim()) {
    ElMessage.warning('请输入词典名称')
    return
  }
  saving.value = true
  try {
    const id = await persistDictionary({ ...dictForm })
    ElMessage.success('词典已保存')
    dictDialogVisible.value = false
    // 新建的词典自动选中
    if (!dictForm.id && id) {
      selectedId.value = id
    }
    await loadDictionaries()
    await loadItems()
    await refreshCache()
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
  finally {
    saving.value = false
  }
}

async function handleDeleteDictionary(dict: Dictionary) {
  try {
    await ElMessageBox.confirm(
      `确定删除词典「${dict.name}」及其全部条目吗？已绑定该词典的字段映射会失效。`,
      '删除词典',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
    await removeDictionary(dict.id)
    ElMessage.success('已删除')
    await loadDictionaries(false)
    await loadItems()
    await refreshCache()
  }
  catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(e instanceof Error ? e.message : String(e))
    }
  }
}

// ------------------------------------------------------------ 条目编辑

/** 新增一行空条目 */
function addItem() {
  if (!selectedId.value) {
    ElMessage.warning('请先选择或新建词典')
    return
  }
  draftItems.value.push({
    id: 0,
    dictionaryId: selectedId.value,
    value: '',
    meaning: '',
    description: '',
    sortOrder: draftItems.value.length,
  })
}

/** 删除一行 */
function removeItem(index: number) {
  draftItems.value.splice(index, 1)
}

/** 保存全部条目 */
async function handleSaveItems() {
  if (!selectedId.value) {
    return
  }
  const invalid = draftItems.value.some(item => !item.value.trim())
  if (invalid) {
    ElMessage.warning('存在「原始值」为空的条目，请填写或删除')
    return
  }

  saving.value = true
  try {
    await persistDictionaryItems(selectedId.value, draftItems.value)
    ElMessage.success('条目已保存')
    await loadItems()
    await refreshCache()
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
  finally {
    saving.value = false
  }
}

/** 刷新全局词典缓存（查询结果的字段翻译依赖它） */
async function refreshCache() {
  await dictStore.loadAll()
}

onMounted(async () => {
  try {
    await loadDictionaries()
    await loadItems()
  }
  finally {
    // 失败也要上报，否则遮罩会一直盖住界面
    emit('ready')
  }
})
</script>

<template>
  <div class="dict-view">
    <header class="dict-view__head">
      <div class="dict-view__title">
        <span class="dict-view__bar" aria-hidden="true" />
        <span>词典</span>
        <small>把查询结果中的原始值翻译成可读文本，供字段映射绑定</small>
      </div>

      <el-button type="primary" @click="openCreateDictionary">
        <el-icon><Plus /></el-icon>
        <span>新建词典</span>
      </el-button>
    </header>

    <div class="dict-view__body">
      <!-- 左：词典列表 -->
      <aside class="dict-view__list">
        <ul v-loading="loading" class="dict-view__items">
          <li
            v-for="dict in dictionaries"
            :key="dict.id"
            class="dict-view__item"
            :class="{ 'is-active': dict.id === selectedId }"
            @click="handleSelect(dict.id)"
          >
            <div class="dict-view__item-main">
              <span class="dict-view__item-name">{{ dict.name }}</span>
              <span class="dict-view__item-desc">{{ dict.description || '无描述' }}</span>
            </div>
            <el-icon
              class="dict-view__item-edit"
              title="编辑"
              @click.stop="openEditDictionary(dict)"
            >
              <Edit />
            </el-icon>
            <el-icon
              class="dict-view__item-del"
              title="删除"
              @click.stop="handleDeleteDictionary(dict)"
            >
              <Delete />
            </el-icon>
          </li>

          <li v-if="!dictionaries.length && !loading" class="dict-view__empty">
            暂无词典，点击右上角新建
          </li>
        </ul>
      </aside>

      <!-- 右：条目编辑 -->
      <section class="dict-view__detail">
        <template v-if="selectedDictionary">
          <div class="dict-view__detail-head">
            <span class="dict-view__detail-name">{{ selectedDictionary.name }}</span>
            <small>{{ draftItems.length }} 条</small>

            <div class="dict-view__detail-actions">
              <el-button size="small" @click="addItem">
                <el-icon><Plus /></el-icon>
                <span>添加条目</span>
              </el-button>
              <el-button
                size="small"
                type="primary"
                :loading="saving"
                @click="handleSaveItems"
              >
                保存条目
              </el-button>
            </div>
          </div>

          <el-table
            v-loading="itemsLoading"
            :data="draftItems"
            size="small"
            height="100%"
            empty-text="暂无条目，点击「添加条目」"
          >
            <el-table-column label="原始值" min-width="150">
              <template #default="{ row }">
                <el-input v-model="row.value" size="small" placeholder="如 1" />
              </template>
            </el-table-column>
            <el-table-column label="显示文本" min-width="150">
              <template #default="{ row }">
                <el-input v-model="row.meaning" size="small" placeholder="如 启用" />
              </template>
            </el-table-column>
            <el-table-column label="备注" min-width="180">
              <template #default="{ row }">
                <el-input v-model="row.description" size="small" placeholder="可选" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" fixed="right">
              <template #default="{ $index }">
                <el-button link type="danger" @click="removeItem($index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>

        <el-empty v-else description="请在左侧选择或新建词典" />
      </section>
    </div>

    <!-- 词典编辑弹窗 -->
    <el-dialog
      v-model="dictDialogVisible"
      :title="dictForm.id ? '编辑词典' : '新建词典'"
      width="460px"
      append-to-body
    >
      <el-form label-width="80px" label-position="right">
        <el-form-item label="名称" required>
          <el-input v-model="dictForm.name" placeholder="如：设备状态" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="dictForm.description"
            type="textarea"
            :rows="2"
            placeholder="用途说明，可选"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dictDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSaveDictionary">
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.dict-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 16px 20px;
}

.dict-view__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex: 0 0 auto;
  margin-bottom: 14px;
}

.dict-view__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--app-font-size-lg);
  font-weight: 600;
}

.dict-view__bar {
  width: 3px;
  height: 15px;
  border-radius: 2px;
  background: var(--brand-color);
}

.dict-view__title small {
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
  font-weight: 400;
}

/* 左列表 + 右明细，撑满剩余高度 */
.dict-view__body {
  display: flex;
  gap: 12px;
  flex: 1;
  min-height: 0;
}

.dict-view__list {
  display: flex;
  flex-direction: column;
  flex: 0 0 240px;
  min-height: 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.dict-view__items {
  flex: 1;
  margin: 0;
  padding: 6px;
  list-style: none;
  overflow: auto;
}

.dict-view__item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.dict-view__item:hover {
  background: var(--hover-bg);
}

.dict-view__item.is-active {
  background: var(--active-bg);
}

.dict-view__item-main {
  flex: 1;
  min-width: 0;
}

.dict-view__item-name {
  display: block;
  font-size: var(--app-font-size);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dict-view__item-desc {
  display: block;
  margin-top: 2px;
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dict-view__item-edit,
.dict-view__item-del {
  flex: 0 0 auto;
  color: var(--text-muted);
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease;
}

.dict-view__item:hover .dict-view__item-edit,
.dict-view__item:hover .dict-view__item-del {
  opacity: 1;
}

.dict-view__item-edit:hover {
  color: var(--brand-color);
}

.dict-view__item-del:hover {
  color: var(--danger-color);
}

.dict-view__empty {
  padding: 20px 10px;
  color: var(--text-muted);
  font-size: var(--app-font-size-sm);
  text-align: center;
}

.dict-view__detail {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.dict-view__detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  font-size: var(--app-font-size);
  font-weight: 600;
}

.dict-view__detail-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dict-view__detail-head small {
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
  font-weight: 400;
}

.dict-view__detail-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.dict-view__detail :deep(.el-table) {
  flex: 1;
  min-height: 0;
}
</style>
