<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import MonacoEditor from '@/components/MonacoEditor.vue'
import VariableConfigPanel from '@/components/VariableConfigPanel.vue'
import FieldMappingPanel from '@/components/FieldMappingPanel.vue'
import {
  DEFAULT_PAGE_SIZE,
  extractVariables,
  fetchTemplate,
  fetchTemplateList,
  persistTemplate,
  removeTemplate,
  validateScript,
} from '@/api/templates'
import { fetchConnections } from '@/api/db'
import type {
  DBConnection,
  FieldMapping,
  SQLTemplate,
  TemplateListItem,
  VariableConfig,
} from '@/types'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
}>()

/** 模板列表 */
const templates = ref<TemplateListItem[]>([])
/** 连接列表 */
const connections = ref<DBConnection[]>([])
/** 当前编辑的模板 ID；0 表示新建 */
const editingId = ref(0)
const loading = ref(false)
const saving = ref(false)

/** 编辑中的表单 */
const form = reactive({
  name: '',
  connId: 0 as number,
  sqlText: '',
  variables: '[]',
  fieldMappings: '[]',
  preScript: '',
  postScript: '',
  paginationEnabled: false,
  pageSize: DEFAULT_PAGE_SIZE,
})

/** 变量配置与字段映射（解析后的对象形式） */
const variableConfigs = ref<VariableConfig[]>([])
const fieldMappings = ref<FieldMapping[]>([])

/** 检测到的变量名 */
const detectedVariables = ref<string[]>([])
/** 配置区当前页签，默认落在基础配置 */
const configTab = ref('basic')

// ------------------------------------------------------------ 加载

async function loadTemplates() {
  loading.value = true
  try {
    templates.value = await fetchTemplateList()
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
  finally {
    loading.value = false
  }
}

async function loadConnections() {
  try {
    connections.value = await fetchConnections()
  }
  catch {
    connections.value = []
  }
}

/** 载入模板到编辑区 */
async function loadTemplate(id: number) {
  try {
    const tpl = await fetchTemplate(id)
    editingId.value = tpl.id
    form.name = tpl.name
    form.connId = tpl.connId
    form.sqlText = tpl.sqlText
    form.preScript = tpl.preScript
    form.postScript = tpl.postScript
    form.paginationEnabled = tpl.paginationEnabled
    form.pageSize = tpl.pageSize > 0 ? tpl.pageSize : DEFAULT_PAGE_SIZE

    variableConfigs.value = parseJSON<VariableConfig[]>(tpl.variables, [])
    fieldMappings.value = parseJSON<FieldMapping[]>(tpl.fieldMappings, [])

    await refreshVariables()
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
}

/** 安全解析 JSON，失败时返回兜底值并提示 */
function parseJSON<T>(raw: string, fallback: T): T {
  if (!raw) {
    return fallback
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T) : fallback
  }
  catch {
    ElMessage.warning('模板中的配置 JSON 解析失败，已重置为空')
    return fallback
  }
}

// ------------------------------------------------------------ 变量解析

/** 重新解析 SQL 中的变量，保留已有配置 */
async function refreshVariables() {
  if (!form.sqlText.trim()) {
    detectedVariables.value = []
    variableConfigs.value = []
    return
  }

  try {
    const names = await extractVariables(form.sqlText)
    detectedVariables.value = names

    const existing = new Map(variableConfigs.value.map(c => [c.name, c]))
    variableConfigs.value = names.map(name =>
      existing.get(name) ?? {
        name,
        label: name,
        component: 'input' as const,
        dataType: 'string' as const,
      },
    )
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
}

/** SQL 变化后防抖重新解析 */
let parseTimer: number | null = null
function scheduleParse() {
  if (parseTimer !== null) {
    window.clearTimeout(parseTimer)
  }
  parseTimer = window.setTimeout(() => {
    parseTimer = null
    void refreshVariables()
  }, 500)
}

// ------------------------------------------------------------ 增删改

/** 新建模板 */
function handleCreate() {
  editingId.value = 0
  form.name = ''
  form.connId = connections.value[0]?.id ?? 0
  form.sqlText = ''
  form.preScript = ''
  form.postScript = ''
  form.paginationEnabled = false
  form.pageSize = DEFAULT_PAGE_SIZE
  variableConfigs.value = []
  fieldMappings.value = []
  detectedVariables.value = []
}

/** 保存模板 */
async function handleSave() {
  if (!form.name.trim()) {
    ElMessage.warning('请输入模板名称')
    return
  }
  if (!form.connId) {
    ElMessage.warning('请选择所属连接')
    return
  }
  if (!form.sqlText.trim()) {
    ElMessage.warning('SQL 内容不能为空')
    return
  }
  if (form.paginationEnabled && !(form.pageSize > 0)) {
    ElMessage.warning('开启分页后，每页条数必须大于 0')
    return
  }

  // 保存前校验脚本语法，避免存入不可用脚本
  try {
    await validateScript(form.preScript)
    await validateScript(form.postScript)
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
    return
  }

  saving.value = true
  try {
    const payload: SQLTemplate = {
      id: editingId.value,
      connId: form.connId,
      name: form.name.trim(),
      sqlText: form.sqlText,
      variables: JSON.stringify(variableConfigs.value),
      fieldMappings: JSON.stringify(fieldMappings.value),
      preScript: form.preScript,
      postScript: form.postScript,
      paginationEnabled: form.paginationEnabled,
      pageSize: form.pageSize > 0 ? form.pageSize : DEFAULT_PAGE_SIZE,
    }

    const id = await persistTemplate(payload)
    editingId.value = id
    ElMessage.success('模板已保存')
    await loadTemplates()
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
  finally {
    saving.value = false
  }
}

/** 删除模板 */
async function handleDelete(item: TemplateListItem) {
  try {
    await ElMessageBox.confirm(
      `确定删除模板「${item.name}」吗？引用它的标签页将无法再执行。`,
      '删除模板',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
    await removeTemplate(item.id)

    // 删除的正是当前编辑的模板时，重置编辑区
    if (editingId.value === item.id) {
      handleCreate()
    }
    ElMessage.success('已删除')
    await loadTemplates()
  }
  catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(e instanceof Error ? e.message : String(e))
    }
  }
}

// ------------------------------------------------------------ 弹窗

onMounted(async () => {
  await loadConnections()
  handleCreate()
})

/** 弹窗打开时刷新列表，保证数据最新 */
watch(() => props.visible, (value) => {
  if (value) {
    void loadTemplates()
    void loadConnections()
  }
})

/** 双向绑定：仅转发，不在此处产生副作用 */
const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    title="SQL 模板管理"
    fullscreen
    :close-on-click-modal="false"
  >
    <div class="tpl-mgr">
      <!-- 左：模板列表 -->
      <aside class="tpl-mgr__list">
        <div class="tpl-mgr__list-head">
          <span>模板列表</span>
          <el-button size="small" type="primary" @click="handleCreate">
            <el-icon><Plus /></el-icon>
            <span>新建</span>
          </el-button>
        </div>

        <ul v-loading="loading" class="tpl-mgr__items">
          <li
            v-for="item in templates"
            :key="item.id"
            class="tpl-mgr__item"
            :class="{ 'is-active': item.id === editingId }"
            @click="loadTemplate(item.id)"
          >
            <div class="tpl-mgr__item-main">
              <span class="tpl-mgr__item-name">{{ item.name }}</span>
              <code class="tpl-mgr__item-sql">{{ item.sqlText }}</code>
            </div>
            <el-icon
              class="tpl-mgr__item-del"
              title="删除"
              @click.stop="handleDelete(item)"
            >
              <Delete />
            </el-icon>
          </li>

          <li v-if="!templates.length && !loading" class="tpl-mgr__empty">
            暂无模板，点击新建创建
          </li>
        </ul>
      </aside>

      <!-- 右：编辑区 -->
      <section class="tpl-mgr__editor">
        <header class="tpl-mgr__editor-head">
          <el-input
            v-model="form.name"
            placeholder="模板名称"
            class="tpl-mgr__name"
          />
          <el-select
            v-model="form.connId"
            placeholder="所属连接"
            class="tpl-mgr__conn"
          >
            <el-option
              v-for="conn in connections"
              :key="conn.id"
              :label="conn.name"
              :value="conn.id"
            />
          </el-select>
          <el-button type="primary" :loading="saving" @click="handleSave">
            保存模板
          </el-button>
        </header>

        <!-- 上方：SQL 编辑器，约占 40% -->
        <div class="tpl-mgr__sql">
          <div class="tpl-mgr__sql-label">
            <span>SQL 模板</span>
            <small>
              用 <code>&#123;&#123; 变量名 &#125;&#125;</code> 插入变量；
              支持 <code>&#123;&#123;if 变量&#125;&#125;...&#123;&#123;end&#125;&#125;</code> 条件拼接
            </small>
          </div>
          <MonacoEditor
            v-model="form.sqlText"
            language="sql"
            height="100%"
            @change="scheduleParse"
          />
        </div>

        <!-- 下方：配置 Tab 区 -->
        <div class="tpl-mgr__config">
          <div class="tpl-mgr__config-head">
            <span>模板配置</span>
            <el-tag v-if="detectedVariables.length" size="small" type="info">
              检测到 {{ detectedVariables.length }} 个变量
            </el-tag>
          </div>

          <el-tabs v-model="configTab" class="tpl-mgr__tabs">
            <el-tab-pane label="基础配置" name="basic">
              <div class="tpl-mgr__basic">
                <div class="tpl-mgr__basic-row">
                  <div class="tpl-mgr__basic-label">
                    <span>结果分页</span>
                    <small>开启后查询结果按页展示，并自动统计总数据量</small>
                  </div>
                  <el-switch v-model="form.paginationEnabled" />
                </div>

                <div class="tpl-mgr__basic-row">
                  <div class="tpl-mgr__basic-label">
                    <span>每页条数</span>
                    <small>仅在开启分页时生效，取值范围 1 - 1000</small>
                  </div>
                  <el-input-number
                    v-model="form.pageSize"
                    :min="1"
                    :max="1000"
                    :disabled="!form.paginationEnabled"
                    size="small"
                    controls-position="right"
                  />
                </div>
              </div>
            </el-tab-pane>

            <el-tab-pane label="变量配置" name="variables">
              <VariableConfigPanel
                v-model="variableConfigs"
                :conn-id="form.connId || null"
              />
            </el-tab-pane>

            <el-tab-pane label="字段映射" name="fields">
              <FieldMappingPanel v-model="fieldMappings" />
            </el-tab-pane>

            <el-tab-pane label="前置脚本" name="pre">
              <p class="tpl-mgr__hint">
                可修改变量并追加 SQL 片段：
                <code>return &#123; variables, sqlFragment &#125;</code>
              </p>
              <MonacoEditor v-model="form.preScript" language="javascript" height="220px" />
            </el-tab-pane>

            <el-tab-pane label="后置脚本" name="post">
              <p class="tpl-mgr__hint">
                可加工结果集：
                <code>return &#123; rows &#125;</code>
              </p>
              <MonacoEditor v-model="form.postScript" language="javascript" height="220px" />
            </el-tab-pane>
          </el-tabs>
        </div>
      </section>
    </div>
  </el-dialog>
</template>

<style scoped>
.tpl-mgr {
  display: flex;
  gap: 12px;
  height: calc(100vh - 140px);
}

/* 左侧列表 */
.tpl-mgr__list {
  display: flex;
  flex-direction: column;
  flex: 0 0 260px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.tpl-mgr__list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
  font-weight: 600;
}

.tpl-mgr__items {
  flex: 1;
  margin: 0;
  padding: 6px;
  list-style: none;
  overflow: auto;
}

.tpl-mgr__item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.tpl-mgr__item:hover {
  background: var(--hover-bg);
}

.tpl-mgr__item.is-active {
  background: var(--active-bg);
}

.tpl-mgr__item-main {
  flex: 1;
  min-width: 0;
}

.tpl-mgr__item-name {
  display: block;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tpl-mgr__item-sql {
  display: block;
  margin-top: 3px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tpl-mgr__item-del {
  flex: 0 0 auto;
  opacity: 0;
  color: var(--text-muted);
}

.tpl-mgr__item:hover .tpl-mgr__item-del {
  opacity: 1;
}

.tpl-mgr__item-del:hover {
  color: var(--danger-color);
}

.tpl-mgr__empty {
  padding: 20px 10px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

/* 右侧编辑区 */
.tpl-mgr__editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  gap: 10px;
}

.tpl-mgr__editor-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tpl-mgr__name {
  width: 220px;
}

.tpl-mgr__conn {
  width: 200px;
}

/* SQL 区约 40% 高度 */
.tpl-mgr__sql {
  display: flex;
  flex-direction: column;
  flex: 0 0 40%;
  min-height: 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.tpl-mgr__sql-label {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-color);
  font-size: 12px;
  font-weight: 600;
}

.tpl-mgr__sql-label small {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 400;
}

.tpl-mgr__sql-label code,
.tpl-mgr__hint code {
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(56, 189, 248, 0.12);
  color: var(--brand-color);
  font-family: var(--font-mono);
}

.tpl-mgr__sql :deep(.monaco-editor) {
  height: 100% !important;
}

.tpl-mgr__sql > :last-child {
  flex: 1;
  min-height: 0;
}

/* 配置 Tab 区填满剩余空间 */
.tpl-mgr__config {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.tpl-mgr__config-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-color);
  font-size: 12px;
  font-weight: 600;
}

.tpl-mgr__tabs {
  flex: 1;
  min-height: 0;
  padding: 0 12px;
}

.tpl-mgr__tabs :deep(.el-tabs__content) {
  height: calc(100% - 40px);
  overflow: auto;
}

.tpl-mgr__hint {
  margin: 0 0 8px;
  color: var(--text-muted);
  font-size: 11px;
}

/* 基础配置：纵向排列的配置行 */
.tpl-mgr__basic {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 520px;
  padding-top: 4px;
}

.tpl-mgr__basic-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--surface-color);
}

.tpl-mgr__basic-label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.tpl-mgr__basic-label > span {
  font-size: 13px;
  font-weight: 600;
}

.tpl-mgr__basic-label small {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 400;
}
</style>
