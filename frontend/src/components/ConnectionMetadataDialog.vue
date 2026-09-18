<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useMetadataStore } from '@/stores/metadataStore'
import { useConfigStore } from '@/stores/configStore'
import { dialectOf } from '@/utils/sql/rowSql'
import { filterDatabaseInfos, parseShowSystemDatabases } from '@/utils/sql/sqlVisibility'
import type { DBConnection } from '@/types'

/**
 * 连接元数据查看：左侧表 / 视图，右侧选中表的字段（名称 / 类型 / 注释）。
 *
 * 数据来自 metadataStore（与 SQL 执行页的智能补全同一份缓存）：
 * 打开弹窗时若缓存命中会立即渲染，只有缺失或过期才真正查询数据库；
 * 在连接管理页点「刷新元数据」后，这里会直接看到新结果。
 */

const props = defineProps<{
  /** 是否显示 */
  visible: boolean
  /** 要查看的连接；为 null 时不加载 */
  connection: DBConnection | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
}>()

const meta = useMetadataStore()
const configStore = useConfigStore()

/** 该连接的方言（系统库判定按它走） */
const dialect = computed(() => dialectOf(props.connection?.dbType ?? ''))

/** 设置项：是否展示系统库（默认展示，与补全候选同一策略） */
const showSystemDatabases = computed(() =>
  parseShowSystemDatabases(configStore.values.sql_show_system_databases))

/** 双向绑定可见性 */
const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

const connId = computed(() => props.connection?.id ?? 0)

/** 当前查看的库 */
const database = ref('')
/** 表名搜索关键字 */
const keyword = ref('')
/** 当前选中的表 */
const selectedTable = ref('')

/**
 * 下拉框展示的库列表（系统库按设置过滤）。
 *
 * 只过滤**展示**：store 里的库一个不少，所以「之前选中的系统库」不会被清掉，
 * 关掉设置也不需要重新拉元数据。
 */
const databases = computed(() => filterDatabaseInfos(
  connId.value ? meta.databaseInfos[connId.value] ?? [] : [],
  dialect.value,
  showSystemDatabases.value,
))

/** 当前库的表 / 视图（按搜索词过滤） */
const tables = computed(() => {
  if (!connId.value || !database.value) {
    return []
  }
  const all = meta.tables[`${connId.value}::${database.value}`] ?? []
  const text = keyword.value.trim().toLowerCase()
  return text ? all.filter(name => name.toLowerCase().includes(text)) : all
})

/** 当前选中表的字段 */
const columns = computed(() => {
  if (!connId.value || !database.value || !selectedTable.value) {
    return []
  }
  return meta.columns[`${connId.value}::${database.value}::${selectedTable.value}`] ?? []
})

const databasesLoading = computed(() => meta.isDatabasesLoading(connId.value))
const tablesLoading = computed(() => meta.isTablesLoading(connId.value, database.value))
const columnsLoading = computed(
  () => meta.isColumnsLoading(connId.value, database.value, selectedTable.value),
)

/** 打开时准备数据：库列表 → 默认库 → 表列表 */
watch(() => props.visible, async (open) => {
  if (!open || !connId.value) {
    return
  }
  keyword.value = ''
  selectedTable.value = ''
  await prepare()
})

/** 载入库列表并选中合适的库 */
async function prepare() {
  try {
    const list = await meta.loadDatabases(connId.value)
    /*
     * 选库优先级：上次查看的库 → 连接自身配置的库 → 列表首项。
     * 这里只是「看元数据」，不会影响 SQL 执行页实际使用的库。
     */
    const preferred = [database.value, props.connection?.database ?? '']
      .find(name => Boolean(name) && list.includes(name))
    /*
     * 兜底取「列表首项」时跳过被隐藏的系统库：隐藏之后还把 information_schema
     * 选中当默认查看对象，会让人以为设置没生效。列表里只有系统库时照旧取首项。
     */
    const visible = filterDatabaseInfos(
      meta.ensureDatabaseInfos(connId.value),
      dialect.value,
      showSystemDatabases.value,
    )
    database.value = preferred ?? visible[0]?.name ?? list[0] ?? ''
    if (database.value) {
      await meta.loadTables(connId.value, database.value)
    }
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
}

/** 切换库：字段列表清空，重新拉表 */
async function handleDatabaseChange() {
  selectedTable.value = ''
  try {
    await meta.loadTables(connId.value, database.value)
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
}

/** 选中表：字段按需加载（缓存命中则直接展示） */
async function selectTable(name: string) {
  selectedTable.value = name
  try {
    await meta.loadColumns(connId.value, database.value, name)
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    :title="`元数据 · ${connection?.name ?? ''}`"
    width="880px"
    align-center
    destroy-on-close
  >
    <div class="meta-dialog">
      <header class="meta-dialog__bar">
        <span class="meta-dialog__label">数据库</span>
        <el-select
          v-model="database"
          class="meta-dialog__db"
          filterable
          :loading="databasesLoading"
          placeholder="选择数据库"
          @change="handleDatabaseChange"
        >
          <el-option
            v-for="info in databases"
            :key="info.name"
            :label="info.name"
            :value="info.name"
          />
        </el-select>

        <el-input
          v-model="keyword"
          class="meta-dialog__search"
          placeholder="搜索表 / 视图"
          clearable
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>

        <span class="meta-dialog__count">{{ tables.length }} 张表 / 视图</span>
        <span class="meta-dialog__conn">
          {{ connection?.dbType }} · {{ connection?.host }}:{{ connection?.port }}
        </span>
      </header>

      <div class="meta-dialog__body">
        <ul v-loading="tablesLoading" class="meta-dialog__tables">
          <li
            v-for="name in tables"
            :key="name"
            class="meta-dialog__table"
            :class="{ 'is-active': name === selectedTable }"
            :title="name"
            @click="selectTable(name)"
          >
            {{ name }}
          </li>
          <li v-if="!tables.length && !tablesLoading" class="meta-dialog__empty">
            {{ database ? '该库下没有表或视图' : '请先选择数据库' }}
          </li>
        </ul>

        <div class="meta-dialog__columns">
          <el-table
            v-loading="columnsLoading"
            :data="columns"
            size="small"
            border
            height="100%"
            empty-text="选择左侧的表查看字段"
          >
            <el-table-column prop="name" label="字段" min-width="150" show-overflow-tooltip />
            <el-table-column prop="dataType" label="类型" min-width="130" show-overflow-tooltip />
            <el-table-column prop="comment" label="注释" min-width="180" show-overflow-tooltip />
          </el-table>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.meta-dialog {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.meta-dialog__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.meta-dialog__label {
  color: var(--text-muted);
  font-size: var(--app-font-size-sm);
}

.meta-dialog__db {
  width: 220px;
}

.meta-dialog__search {
  width: 200px;
}

.meta-dialog__count {
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
}

.meta-dialog__conn {
  margin-left: auto;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--app-font-size-xs);
}

.meta-dialog__body {
  display: flex;
  gap: 12px;
  height: 460px;
  min-height: 0;
}

/* 左侧表列表：固定宽、内部滚动 */
.meta-dialog__tables {
  display: flex;
  flex-direction: column;
  flex: 0 0 240px;
  margin: 0;
  padding: 6px;
  list-style: none;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: auto;
}

/*
 * flex: 0 0 auto 必不可少：
 * 列表是纵向 flex 容器，条目默认可收缩；系统库动辄上百张表，
 * 不加这一行会被平均压扁成几像素高（表现为每行只露出文字上沿）。
 */
.meta-dialog__table {
  flex: 0 0 auto;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: var(--app-font-size-sm);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.meta-dialog__table:hover {
  background: var(--hover-bg);
}

.meta-dialog__table.is-active {
  background: var(--active-bg);
}

.meta-dialog__empty {
  flex: 0 0 auto;
  padding: 18px 10px;
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
  text-align: center;
}

/* 右侧字段表 */
.meta-dialog__columns {
  flex: 1;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}
</style>
