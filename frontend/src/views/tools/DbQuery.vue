<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import DynamicForm from '@/components/DynamicForm.vue'
import ResultTable from '@/components/ResultTable.vue'
import ResultPagination from '@/components/ResultPagination.vue'
import ExecutionLog from '@/components/ExecutionLog.vue'
import { DEFAULT_PAGE_SIZE, executeTemplateQuery, fetchTemplate, fetchTemplateList } from '@/api/templates'
import { fetchConnections } from '@/api/db'
import { EventsOn } from '@/api/runtime'
import { useLogStore } from '@/stores/logStore'
import { useTabStore } from '@/stores/tabStore'
import type {
  DBConnection,
  DbQueryPayload,
  FieldMapping,
  QueryResult,
  TemplateListItem,
  ToolType,
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
  /** 首次初始化完成（父级据此关闭 loading 遮罩） */
  (e: 'ready'): void
}>()

const logStore = useLogStore()
const tabStore = useTabStore()

/** 跳转到单例功能标签页（连接管理 / SQL 模板） */
function openTool(type: ToolType) {
  tabStore.openTool(type)
}

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
/**
 * 每页条数：属于当前 Tab 的私有状态，不写入模板。
 * 这样同一个模板在不同标签页可以各用各的分页大小。
 */
const pageSize = ref(DEFAULT_PAGE_SIZE)
/** 上一次执行得到的总数，翻页时带回后端以避免重复统计 */
const lastTotal = ref(0)

// 连接管理与 SQL 模板已改为独立标签页，这里不再维护弹窗状态

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
 *
 * targetPage 为要查询的页码；模板未开启分页时后端会忽略该参数。
 * reuseTotal 为真表示翻页：沿用上次的总数，后端不再重复统计，
 * 只有重新执行（新条件、改页大小、换模板/连接）时才重新统计。
 */
async function handleRun(targetPage = 1, reuseTotal = false) {
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

  try {
    // 只传模板 ID 与变量值；SQL 与脚本由后端从模板读取
    const data = await executeTemplateQuery({
      templateId: templateId.value,
      connId: connId.value,
      variables: values,
      page: requestPage,
      pageSize: paginationEnabled.value ? pageSize.value : 0,
      total: reuseTotal ? lastTotal.value : 0,
      countTotal: !reuseTotal,
    })
    result.value = data
    lastTotal.value = data.total
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

/**
 * 翻页：沿用上次统计到的总数，后端不再重复统计。
 */
function changePage(target: number) {
  void handleRun(target, true)
}

/**
 * 修改每页条数：回到第一页重新查询。
 * 总数与页大小无关，已有总数时同样可以复用。
 */
function changePageSize(size: number) {
  if (size <= 0 || size === pageSize.value) {
    return
  }
  pageSize.value = size
  page.value = 1
  void handleRun(1, lastTotal.value > 0)
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
    pageSize: pageSize.value,
  }

  const signature = JSON.stringify(payload)
  if (signature === lastEmittedSignature) {
    return
  }
  lastEmittedSignature = signature

  emit('change', props.tabId, payload)
}

/** 模板/连接/每页条数变化时上报；变量值由表单的 change 事件主动触发上报 */
watch(
  () => JSON.stringify([templateId.value, connId.value, pageSize.value]),
  () => notifyChange(),
)

/** 切换模板时重新加载其配置，并回到第一页 */
watch(templateId, id => {
  void loadTemplateConfig(id)
  result.value = null
  page.value = 1
  lastTotal.value = 0
})

/** 切换连接后原结果不再对应当前库，清空并重置分页 */
watch(connId, () => {
  result.value = null
  page.value = 1
  lastTotal.value = 0
})

/**
 * 其他标签页的数据变更通知。
 *
 * 连接管理 / SQL 模板是独立的单例标签页，改动后通过事件广播；
 * 这里据此刷新下拉与当前引用模板的配置（变量表单由模板驱动）。
 */
const offTemplatesChanged = EventsOn('templates:changed', async () => {
  await loadTemplates()
  if (templateId.value) {
    await loadTemplateConfig(templateId.value)
  }
})

const offConnectionsChanged = EventsOn('connections:changed', async () => {
  await loadConnections()
})

onBeforeUnmount(() => {
  offTemplatesChanged()
  offConnectionsChanged()
})

// ------------------------------------------------------------ 生命周期

onMounted(async () => {
  try {
    // 恢复上次状态
    templateId.value = (props.initialPayload.templateId as number) ?? null
    connId.value = (props.initialPayload.connId as number) ?? null
    variableValues.value =
      (props.initialPayload.variableValues as Record<string, unknown>) ?? {}
    // 每页条数是本标签的私有状态，从 payload 恢复
    const savedPageSize = Number(props.initialPayload.pageSize)
    pageSize.value = savedPageSize > 0 ? savedPageSize : DEFAULT_PAGE_SIZE

    await Promise.all([loadTemplates(), loadConnections()])

    if (templateId.value) {
      await loadTemplateConfig(templateId.value)
    }
  }
  finally {
    // 失败也要上报，否则遮罩会一直盖住界面
    emit('ready')
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

        <!-- 图标按钮：跳转到对应的单例标签页 -->
        <el-button
          class="db-query__icon-btn"
          title="连接管理"
          @click="openTool('connections')"
        >
          <el-icon><Link /></el-icon>
        </el-button>

        <el-button
          class="db-query__icon-btn"
          title="SQL 模板管理"
          @click="openTool('sql-template')"
        >
          <el-icon><Document /></el-icon>
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
          <span class="db-query__section-bar" aria-hidden="true" />
          <span>查询条件</span>
          <small v-if="currentTemplate">
            来自模板「{{ currentTemplate.name }}」
          </small>
          <small v-if="templateId && variableConfigs.length">
            共 {{ variableConfigs.length }} 项
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
          @submit="handleRun()"
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
          @change="changePage"
          @size-change="changePageSize"
        />
      </section>
    </div>

    <!-- 底部：执行记录 -->
    <ExecutionLog />
  </div>
</template>

<style scoped>
.db-query {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* 图标按钮：只显示图标，跳转到对应的单例标签页 */
.db-query__icon-btn {
  padding: 8px 10px;
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
  padding: 14px 16px 16px;
  border-bottom: 1px solid var(--border-color);
}

.db-query__section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: var(--app-font-size);
  font-weight: 600;
}

/* 标题前的强调条，弱化版的分区标记 */
.db-query__section-bar {
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: var(--brand-color);
}

.db-query__section-title small {
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
  font-weight: 400;
}

/* 条件数量靠右，与模板来源形成左右信息分布 */
.db-query__section-title small:last-child {
  margin-left: auto;
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
  font-size: var(--app-font-size);
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
}

.db-query__result-meta {
  color: var(--text-muted);
  font-size: var(--app-font-size-sm);
  font-weight: 400;
}
</style>
