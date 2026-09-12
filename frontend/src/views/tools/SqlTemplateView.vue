<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Events } from '@wailsio/runtime'
import MonacoEditor from '@/components/MonacoEditor.vue'
import VariableConfigPanel from '@/components/VariableConfigPanel.vue'
import FieldMappingPanel from '@/components/FieldMappingPanel.vue'
import {
  extractVariables,
  fetchTemplate,
  fetchTemplateList,
  persistTemplate,
  removeTemplate,
  validateScript,
} from '@/api/templates'
import { fetchConnections } from '@/api/db'
import { SNIPPET_CATEGORIES, SQL_SNIPPETS } from '@/utils/sqlSnippets'
import type { SqlSnippet } from '@/utils/sqlSnippets'
import type {
  DBConnection,
  FieldMapping,
  SQLTemplate,
  TemplateListItem,
  VariableConfig,
} from '@/types'

/**
 * SQL 模板管理（单例标签页）。
 *
 * 与其他标签的关系：模板增删改后广播 `templates:changed`，
 * SQL 查询标签页据此刷新模板下拉与当前模板配置
 * （变量表单由模板驱动，模板改了配置也变了）。
 */

const emit = defineEmits<{
  /** 首次加载完成（父级据此关闭 loading 遮罩） */
  (e: 'ready'): void
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
    form.paginationEnabled = tpl.paginationEnabled
    form.sqlText = tpl.sqlText
    form.preScript = tpl.preScript
    form.postScript = tpl.postScript

    variableConfigs.value = parseJSON<VariableConfig[]>(tpl.variables, [])
    fieldMappings.value = reuseUnchanged(parseJSON<FieldMapping[]>(tpl.fieldMappings, []))

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

/**
 * 复用与上一份配置内容相同（按 column 匹配）的映射对象。
 * 引用不变配合 FieldMappingPanel 的 v-memo，可以让未变化的行跳过 patch，
 * 避免映射条目多时（如 72 列结果集）每次选模板都全量重渲染。
 */
function reuseUnchanged(next: FieldMapping[]): FieldMapping[] {
  const prev = new Map(fieldMappings.value.map(m => [m.column, m]))
  return next.map((item) => {
    const old = prev.get(item.column)
    return old && JSON.stringify(old) === JSON.stringify(item) ? old : item
  })
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

/** 广播模板变更，供其他标签页（SQL 查询）刷新模板列表与配置 */
function notifyChanged() {
  void Events.Emit('templates:changed')
}

/** 新建模板 */
function handleCreate() {
  editingId.value = 0
  form.name = ''
  form.connId = connections.value[0]?.id ?? 0
  form.sqlText = ''
  form.preScript = ''
  form.postScript = ''
  form.paginationEnabled = false
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
    }

    const id = await persistTemplate(payload)
    editingId.value = id
    ElMessage.success('模板已保存')
    await loadTemplates()
    notifyChanged()
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
    notifyChanged()
  }
  catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(e instanceof Error ? e.message : String(e))
    }
  }
}

// ------------------------------------------------------------ 片段插入

/** SQL 编辑器实例，用于在当前光标处插入片段 */
const sqlEditorRef = ref<InstanceType<typeof MonacoEditor> | null>(null)
/** 片段选择弹窗 */
const snippetVisible = ref(false)
/** 当前选中的分类 */
const snippetCategory = ref<string>(SNIPPET_CATEGORIES[0])
/** 当前选中的片段 */
const selectedSnippet = ref<SqlSnippet>(SQL_SNIPPETS[0])

/** 当前分类下的片段 */
const visibleSnippets = computed(() =>
  SQL_SNIPPETS.filter(item => item.category === snippetCategory.value),
)

/** 打开弹窗时默认选中该分类的第一项 */
function openSnippetPicker() {
  const first = visibleSnippets.value[0]
  if (first) {
    selectedSnippet.value = first
  }
  snippetVisible.value = true
}

/**
 * 把片段插入到光标处。
 * 插入后编辑器会触发 change，由防抖逻辑自动重新解析变量。
 */
function insertSnippet(snippet: SqlSnippet) {
  if (!sqlEditorRef.value?.insertText(snippet.code)) {
    ElMessage.warning('编辑器尚未就绪，请稍后再试')
    return
  }
  snippetVisible.value = false
}

// ------------------------------------------------------------ 初始化

// 标签页挂载即加载数据（标签关闭重开时会重新加载）
onMounted(async () => {
  try {
    await Promise.all([loadTemplates(), loadConnections()])

    // 默认选中列表第一项；没有模板时才进入「新建」状态
    if (templates.value.length > 0) {
      await loadTemplate(templates.value[0].id)
    }
    else {
      handleCreate()
    }
  }
  finally {
    // 失败也要上报，否则遮罩会一直盖住界面
    emit('ready')
  }
})
</script>

<template>
  <div class="tpl-workspace">
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
            <el-button
              class="tpl-mgr__sql-insert"
              size="small"
              @click="openSnippetPicker"
            >
              <el-icon><Plus /></el-icon>
              <span>插入模板</span>
            </el-button>
          </div>
          <MonacoEditor
            ref="sqlEditorRef"
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
                    <small>
                      开启后查询结果按页展示，并自动统计总数据量；
                      每页条数在结果下方的翻页控件上设置，按标签页各自保存
                    </small>
                  </div>
                  <el-switch v-model="form.paginationEnabled" />
                </div>
              </div>
            </el-tab-pane>

            <!-- lazy：未激活不挂载，避免隐藏的 Monaco/面板在每次选模板时被无谓更新 -->
            <el-tab-pane label="变量配置" name="variables" lazy>
              <VariableConfigPanel
                v-model="variableConfigs"
                :conn-id="form.connId || null"
              />
            </el-tab-pane>

            <el-tab-pane label="字段映射" name="fields" lazy>
              <FieldMappingPanel v-model="fieldMappings" />
            </el-tab-pane>

            <el-tab-pane label="前置脚本" name="pre" lazy>
              <p class="tpl-mgr__hint">
                可修改变量并追加 SQL 片段：
                <code>return &#123; variables, sqlFragment &#125;</code>
              </p>
              <MonacoEditor v-model="form.preScript" language="javascript" height="220px" />
            </el-tab-pane>

            <el-tab-pane label="后置脚本" name="post" lazy>
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

    <!-- 插入模板片段：左侧选择，右侧预览 -->
    <el-dialog
      v-model="snippetVisible"
      title="插入模板片段"
      width="860px"
      top="8vh"
      append-to-body
      class="snippet-dlg"
    >
      <div class="snippet">
        <!-- 左：分类 + 片段列表 -->
        <aside class="snippet__list">
          <el-radio-group v-model="snippetCategory" size="small" class="snippet__cats">
            <el-radio-button
              v-for="category in SNIPPET_CATEGORIES"
              :key="category"
              :value="category"
            >
              {{ category }}
            </el-radio-button>
          </el-radio-group>

          <ul class="snippet__items">
            <li
              v-for="item in visibleSnippets"
              :key="item.id"
              class="snippet__item"
              :class="{ 'is-active': selectedSnippet.id === item.id }"
              @click="selectedSnippet = item"
              @dblclick="insertSnippet(item)"
            >
              {{ item.name }}
            </li>
          </ul>
        </aside>

        <!-- 右：预览 -->
        <section v-if="selectedSnippet" class="snippet__preview">
          <h4 class="snippet__title">{{ selectedSnippet.name }}</h4>
          <p class="snippet__desc">{{ selectedSnippet.description }}</p>

          <div class="snippet__block">
            <div class="snippet__block-label">插入内容</div>
            <pre class="snippet__code">{{ selectedSnippet.code }}</pre>
          </div>

          <div class="snippet__block">
            <div class="snippet__block-label">示例</div>
            <pre class="snippet__code snippet__code--example">{{ selectedSnippet.example }}</pre>
          </div>

          <p class="snippet__tip">
            双击左侧列表项可直接插入；插入后片段中的「变量」会被自动选中，可直接改写。
          </p>
        </section>
      </div>

      <template #footer>
        <el-button @click="snippetVisible = false">关闭</el-button>
        <el-button type="primary" @click="insertSnippet(selectedSnippet)">
          插入
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 标签页内：内容铺满可用区域，各分区内部自行滚动 */
.tpl-workspace {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.tpl-mgr {
  display: flex;
  gap: 12px;
  flex: 1;
  min-width: 0;
  min-height: 0;
  width: 100%;
  padding: 12px;
  box-sizing: border-box;
  overflow: hidden;
}

/* 左侧列表：固定宽度、占满高度，条目超出自带滚动条 */
.tpl-mgr__list {
  display: flex;
  flex-direction: column;
  flex: 0 0 260px;
  min-height: 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.tpl-mgr__list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  font-size: var(--app-font-size);
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
  font-size: var(--app-font-size);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tpl-mgr__item-sql {
  display: block;
  margin-top: 3px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--app-font-size-xs);
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
  font-size: var(--app-font-size-sm);
  text-align: center;
}

/* 右侧编辑区：头部固定，SQL 区按比例，配置区吃掉剩余空间 */
.tpl-mgr__editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  gap: 10px;
}

.tpl-mgr__editor-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.tpl-mgr__name {
  width: 220px;
}

.tpl-mgr__conn {
  width: 200px;
}

/* SQL 区固定占编辑区高度的 40% */
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
  font-size: var(--app-font-size-sm);
  font-weight: 600;
}

.tpl-mgr__sql-label small {
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
  font-weight: 400;
}

/* 「插入模板」按钮靠标题行最右侧 */
.tpl-mgr__sql-insert {
  margin-left: auto;
}

.tpl-mgr__sql-insert .el-icon {
  margin-right: 4px;
}

/* 片段选择弹窗：左列表 / 右预览 */
.snippet {
  display: flex;
  gap: 14px;
  min-height: 380px;
}

.snippet__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 0 0 300px;
}

.snippet__cats {
  flex: 0 0 auto;
}

.snippet__cats :deep(.el-radio-button__inner) {
  padding: 6px 10px;
  font-size: var(--app-font-size-sm);
}

.snippet__items {
  flex: 1;
  margin: 0;
  padding: 4px;
  list-style: none;
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
}

.snippet__item {
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--app-font-size);
}

.snippet__item:hover {
  background: var(--hover-bg);
}

.snippet__item.is-active {
  background: var(--active-bg);
}

.snippet__preview {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.snippet__title {
  margin: 0;
  font-size: var(--app-font-size-lg);
}

.snippet__desc {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--app-font-size-sm);
  line-height: 1.6;
}

.snippet__block-label {
  margin-bottom: 4px;
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
}

.snippet__code {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--surface-color);
  color: var(--text-color);
  font-family: var(--font-mono);
  font-size: var(--app-font-size-sm);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}

.snippet__code--example {
  color: var(--text-muted);
}

.snippet__tip {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
  line-height: 1.6;
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

/* 配置 Tab 区吃掉剩余空间，内容超出自带滚动条 */
.tpl-mgr__config {
  display: flex;
  flex-direction: column;
  flex: 1 1 0%;
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
  font-size: var(--app-font-size-sm);
  font-weight: 600;
}

/* Tab 区：表头固定，内容区占满剩余空间并内部滚动 */
.tpl-mgr__tabs {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 0 12px;
}

.tpl-mgr__tabs :deep(.el-tabs__header) {
  flex: 0 0 auto;
  margin: 0;
}

.tpl-mgr__tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.tpl-mgr__hint {
  margin: 0 0 8px;
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
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
  font-size: var(--app-font-size);
  font-weight: 600;
}

.tpl-mgr__basic-label small {
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
  font-weight: 400;
}
</style>
