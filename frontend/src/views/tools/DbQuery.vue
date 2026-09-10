<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import DynamicForm from '@/components/DynamicForm.vue'
import ResultTable from '@/components/ResultTable.vue'
import ResultPagination from '@/components/ResultPagination.vue'
import ConnectionManager from '@/components/ConnectionManager.vue'
import ExecutionLog from '@/components/ExecutionLog.vue'
import TemplateManagerDialog from '@/views/TemplateManagerDialog.vue'
import { DEFAULT_PAGE_SIZE, executeTemplateQuery, fetchTemplate, fetchTemplateList } from '@/api/templates'
import { fetchConnections } from '@/api/db'
import { useLogStore } from '@/stores/logStore'
import type {
  DBConnection,
  DbQueryPayload,
  FieldMapping,
  QueryResult,
  TemplateListItem,
  VariableConfig,
} from '@/types'

const props = defineProps<{
  /** 所属 Tab 的 ID，回传状态时一并返回 */
  tabId: number
  /** 从 Tab payload 恢复的状态 */
  initialPayload: Record<string, unknown>
}>()

const emit = defineEmits<{
  (e: 'change', tabId: number, payload: DbQueryPayload): void
}>()

const logStore = useLogStore()

/** 模板列表与连接列表 */
const templates = ref<TemplateListItem[]>([])
const connections = ref<DBConnection[]>([])

/** 当前选中的模板与连接 */
const templateId = ref<number | null>(null)
const connId = ref<number | null>(null)

/** 当前模板解析出的变量配置；由模板决定，查询页只读 */
const variableConfigs = ref<VariableConfig[]>([])
const fieldMappings = ref<FieldMapping[]>([])

/** 变量值 */
const variableValues = ref<Record<string, unknown>>({})

/** 执行状态与结果 */
const result = ref<QueryResult | null>(null)
const running = ref(false)

/** 模板是否开启结果分页；由模板的基础配置决定，查询页只读 */
const paginationEnabled = ref(false)
/** 当前页码，从 1 开始 */
const page = ref(1)
/** 每页条数，取自模板配置 */
const pageSize = ref(DEFAULT_PAGE_SIZE)

/** 连接管理弹窗 */
const connectionDialogVisible = ref(false)
/** SQL 模板管理弹窗 */
const templateDialogVisible = ref(false)

const formRef = ref<{ getValues: () => Record<string, unknown> } | null>(null)

/** 当前选中的模板项 */
const currentTemplate = computed(
  () => templates.value.find(t => t.id === templateId.value) ?? null,
)

/** 当前连接对象，用于日志展示连接名 */
const currentConnection = computed(
  () => connections.value.find(c => c.id === connId.value) ?? null,
)

// ------------------------------------------------------------ 加载

async function loadTemplates() {
  try {
    templates.value = await fetchTemplateList()
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
}

async function loadConnections() {
  try {
    connections.value = await fetchConnections()
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
}

/**
 * 载入模板配置。
 * 变量表单由模板中的变量配置驱动，因此需要拉取模板完整内容。
 */
async function loadTemplateConfig(id: number | null) {
  if (!id) {
    variableConfigs.value = []
    fieldMappings.value = []
    paginationEnabled.value = false
    pageSize.value = DEFAULT_PAGE_SIZE
    return
  }

  try {
    const tpl = await fetchTemplate(id)
    variableConfigs.value = parseJSON<VariableConfig[]>(tpl.variables, [])
    fieldMappings.value = parseJSON<FieldMapping[]>(tpl.fieldMappings, [])
    paginationEnabled.value = tpl.paginationEnabled
    pageSize.value = tpl.pageSize > 0 ? tpl.pageSize : DEFAULT_PAGE_SIZE

    // 连接未显式选择时，跟随模板配置
    if (!connId.value && tpl.connId) {
      connId.value = tpl.connId
    }
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
    variableConfigs.value = []
    fieldMappings.value = []
    paginationEnabled.value = false
    pageSize.value = DEFAULT_PAGE_SIZE
  }
}

/** 安全解析 JSON */
function parseJSON<T>(raw: string, fallback: T): T {
  if (!raw) {
    return fallback
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T) : fallback
  }
  catch {
    return fallback
  }
}

// ------------------------------------------------------------ 执行

/**
 * 执行查询。
 * targetPage 为要查询的页码；模板未开启分页时后端会忽略该参数。
 */
async function handleRun(targetPage = 1) {
  if (!templateId.value) {
    ElMessage.warning('请先选择 SQL 模板')
    return
  }
  if (!connId.value) {
    ElMessage.warning('请选择数据库连接')
    return
  }

  running.value = true
  const values = formRef.value?.getValues() ?? variableValues.value
  const requestPage = paginationEnabled.value ? Math.max(targetPage, 1) : 0

  logStore.logInfo(
    paginationEnabled.value
      ? `使用模板「${currentTemplate.value?.name ?? templateId.value}」查询第 ${requestPage} 页`
      : `使用模板「${currentTemplate.value?.name ?? templateId.value}」开始执行`,
  )

  try {
    // 只传模板 ID 与变量值；SQL 与脚本由后端从模板读取
    const data = await executeTemplateQuery(
      templateId.value,
      connId.value,
      values,
      requestPage,
      paginationEnabled.value ? pageSize.value : 0,
    )
    result.value = data
    // 以服务端返回的页码为准，避免页码越界后界面与数据不一致
    page.value = data.page > 0 ? data.page : 1
    if (data.pageSize > 0) {
      pageSize.value = data.pageSize
    }

    // 记录请求与响应，便于排查
    logStore.logRequest(
      currentConnection.value?.name ?? String(connId.value),
      data.sql,
    )
    logStore.logSuccess(data.rowCount, data.elapsedMs)

    if (data.truncated) {
      ElMessage.warning(`结果超过上限，仅展示前 ${data.rowCount} 行`)
    }
  }
  catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    result.value = null
    logStore.logError(message)
    ElMessage.error(message)
  }
  finally {
    running.value = false
  }
}

// ------------------------------------------------------------ 状态同步

/**
 * 上次上报的状态指纹，用于去重。
 * 工具回传状态会触发父组件保存，若不去重极易与渲染形成循环。
 */
let lastEmittedSignature = ''

/**
 * 上报当前状态。
 * 变量值直接读表单实例，不再维护额外的响应式镜像——
 * 镜像每次收到新对象都会触发 watch，是渲染循环的常见来源。
 */
function notifyChange() {
  const values = formRef.value?.getValues() ?? variableValues.value

  const payload: DbQueryPayload = {
    templateId: templateId.value,
    connId: connId.value,
    variableValues: values,
  }

  const signature = JSON.stringify(payload)
  if (signature === lastEmittedSignature) {
    return
  }
  lastEmittedSignature = signature

  emit('change', props.tabId, payload)
}

/** 仅在模板/连接变化时上报；变量值由表单的 change 事件主动触发上报 */
watch(
  () => JSON.stringify([templateId.value, connId.value]),
  () => notifyChange(),
)

/** 切换模板时重新加载其配置，并回到第一页 */
watch(templateId, id => {
  void loadTemplateConfig(id)
  result.value = null
  page.value = 1
})

/** 模板管理弹窗关闭后刷新模板列表，保证新建/修改后的模板立即可用 */
watch(templateDialogVisible, async (visible) => {
  if (visible) {
    return
  }
  await loadTemplates()
  if (templateId.value) {
    await loadTemplateConfig(templateId.value)
  }
})

// ------------------------------------------------------------ 生命周期

onMounted(async () => {
  // 恢复上次状态
  templateId.value = (props.initialPayload.templateId as number) ?? null
  connId.value = (props.initialPayload.connId as number) ?? null
  variableValues.value =
    (props.initialPayload.variableValues as Record<string, unknown>) ?? {}

  await Promise.all([loadTemplates(), loadConnections()])

  if (templateId.value) {
    await loadTemplateConfig(templateId.value)
  }
})
</script>

<template>
  <div class="db-query">
    <!-- 顶部操作栏：选模板 → 选连接 → 执行 -->
    <header class="db-query__toolbar">
      <div class="db-query__toolbar-left">
        <el-select
          v-model="templateId"
          placeholder="选择 SQL 模板"
          clearable
          filterable
          style="width: 240px"
        >
          <el-option
            v-for="tpl in templates"
            :key="tpl.id"
            :label="tpl.name"
            :value="tpl.id"
          />
        </el-select>

        <el-select
          v-model="connId"
          placeholder="选择数据库连接"
          clearable
          filterable
          style="width: 200px"
        >
          <el-option
            v-for="conn in connections"
            :key="conn.id"
            :label="`${conn.name} (${conn.dbType})`"
            :value="conn.id"
          />
        </el-select>

        <el-button @click="connectionDialogVisible = true">
          <el-icon><Setting /></el-icon>
          <span>管理连接</span>
        </el-button>

        <el-button @click="templateDialogVisible = true">
          <el-icon><Document /></el-icon>
          <span>SQL 模板管理</span>
        </el-button>
      </div>

      <div class="db-query__toolbar-right">
        <el-button type="primary" :loading="running" @click="handleRun()">
          <el-icon><VideoPlay /></el-icon>
          <span>执行查询</span>
        </el-button>
      </div>
    </header>

    <!-- 主体：上为查询条件，下为查询结果 -->
    <div class="db-query__body">
      <section class="db-query__form">
        <div class="db-query__section-title">
          <span>查询条件</span>
          <small v-if="currentTemplate">
            来自模板「{{ currentTemplate.name }}」
          </small>
        </div>

        <el-empty
          v-if="!templateId"
          description="请选择 SQL 模板后填写变量"
          :image-size="70"
        />

        <DynamicForm
          v-else
          ref="formRef"
          :key="templateId"
          :configs="variableConfigs"
          :conn-id="connId"
          inline
          @change="notifyChange"
        />
      </section>

      <section class="db-query__result">
        <div class="db-query__result-head">
          <span>查询结果</span>
          <span v-if="result" class="db-query__result-meta">
            {{ result.rowCount }} 行 · {{ result.elapsedMs }} ms
            <template v-if="paginationEnabled">
              · 共 {{ result.total }} 条
            </template>
          </span>
        </div>

        <ResultTable
          v-if="result"
          :result="result"
          :mappings="fieldMappings"
        />
        <el-empty v-else description="尚未执行查询" />

        <ResultPagination
          v-if="result && paginationEnabled"
          :page="page"
          :page-size="pageSize"
          :total="result.total"
          :page-count="result.pageCount"
          :loading="running"
          @change="handleRun"
        />
      </section>
    </div>

    <!-- 底部：执行记录 -->
    <ExecutionLog />

    <!-- 连接管理 -->
    <ConnectionManager
      v-model:visible="connectionDialogVisible"
      @change="loadConnections"
    />

    <!-- SQL 模板管理（全屏） -->
    <TemplateManagerDialog v-model:visible="templateDialogVisible" />
  </div>
</template>

<style scoped>
.db-query {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.db-query__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-color);
}

.db-query__toolbar-left,
.db-query__toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 条件区在上、结果区在下 */
.db-query__body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.db-query__form {
  flex: 0 0 auto;
  max-height: 45%;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px 14px;
  border-bottom: 1px solid var(--border-color);
}

.db-query__section-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
}

.db-query__section-title small {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 400;
}

.db-query__result {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.db-query__result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
}

.db-query__result-meta {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 400;
}
</style>
