<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  fetchConnection,
  fetchConnections,
  persistConnection,
  removeConnection,
  testConnection,
} from '@/api/db'
import ConnectionMetadataDialog from '@/components/ConnectionMetadataDialog.vue'
import { Events } from '@wailsio/runtime'
import { useMetadataStore } from '@/stores/metadataStore'
import type { ConnectionEnv, DBConnection } from '@/types'

/**
 * 连接管理（单例标签页）。
 *
 * 布局与 SQL 模板管理一致：左侧连接列表，右侧是选中连接的详情表单
 * （基本 / 高级 / SSL 三个页签，与原先弹窗里的分页相同）。
 *
 * 与其他标签的关系：连接变更后广播 `connections:changed`，
 * SQL 查询标签页监听该事件刷新连接下拉。
 */

const emit = defineEmits<{
  /** 首次加载完成（父级据此关闭 loading 遮罩） */
  (e: 'ready'): void
}>()

/** 支持的数据库类型 */
const DB_TYPES = [
  { value: 'mysql', label: 'MySQL' },
  { value: 'postgres', label: 'PostgreSQL' },
]

/** 各类型默认端口 */
const DEFAULT_PORTS: Record<string, number> = {
  mysql: 3306,
  postgres: 5432,
}

/**
 * SSL 模式（统一一套取值，后端按方言映射：
 * MySQL → tls=preferred/skip-verify/true，PostgreSQL → sslmode）。
 */
const SSL_MODES = [
  { value: 'disable', label: 'disable（不加密）' },
  { value: 'prefer', label: 'prefer（优先加密）' },
  { value: 'require', label: 'require（必须加密，不校验证书）' },
  { value: 'verify-ca', label: 'verify-ca（校验 CA）' },
  { value: 'verify-full', label: 'verify-full（校验 CA 与主机名）' },
]

/** 各 SSL 模式的说明（SSL 页底部展示） */
const SSL_HINTS: Record<string, string> = {
  disable: '不启用加密，内网直连一般够用。',
  prefer: '优先加密，服务端不支持时回退为明文连接。',
  require: '强制加密但不校验证书（MySQL → tls=skip-verify，PostgreSQL → sslmode=require）。',
  'verify-ca': '强制加密并校验服务端证书由指定 CA 签发，需填写 CA 证书路径。',
  'verify-full': '强制加密并校验服务端证书与主机名，需填写 CA 证书路径。',
}

/** 详情页签 */
const activeTab = ref('basic')

/** SSL 页的说明文案 */
const sslHint = computed(() => SSL_HINTS[form.sslMode] ?? SSL_HINTS.disable)

const connections = ref<DBConnection[]>([])
const loading = ref(false)
const testing = ref(false)
const saving = ref(false)

/**
 * 正在编辑的连接 ID；0 表示「新建」。
 * 同时用作左侧列表的选中态。
 */
const editingId = ref(0)
const form = reactive<DBConnection>(createEmptyForm())

/**
 * 元数据缓存（与 SQL 执行页的智能补全共用同一份）。
 * 在这里刷新后，查询页补全立刻用到新数据，不需要各自维护缓存。
 */
const metadataStore = useMetadataStore()
/** 元数据查看弹窗 */
const metadataVisible = ref(false)
/** 元数据刷新中 */
const metadataRefreshing = ref(false)

/** 当前编辑的已保存连接；新建（未保存）时为 null */
const savedConnection = computed(
  () => connections.value.find(item => item.id === editingId.value) ?? null,
)

function createEmptyForm(): DBConnection {
  return {
    id: 0,
    name: '',
    dbType: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    database: '',
    username: '',
    password: '',
    extra: '',
    note: '',
    color: '',
    charset: '',
    defaultSchema: '',
    connectTimeoutSecs: 10,
    queryTimeoutSecs: 60,
    keepaliveSecs: 30,
    sslMode: 'disable',
    sslCaPath: '',
    sslCertPath: '',
    sslKeyPath: '',
    urlParams: '',
    readOnly: false,
    isLocal: false,
    isTest: false,
    isProduction: false,
  }
}

/** 加载连接列表 */
async function load() {
  loading.value = true
  try {
    connections.value = await fetchConnections()
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
  finally {
    loading.value = false
  }
}

/** 广播连接变更，供其他标签页刷新 */
function notifyChanged() {
  void Events.Emit('connections:changed')
}

/**
 * 当前连接的环境标识；本地 / 测试 / 生产三者互斥，空串表示未标记。
 * 用「单一取值 + 三个勾选框」表达互斥，比三个独立布尔更不容易出现冲突状态。
 */
const envMark = computed<ConnectionEnv>(() => {
  if (form.isProduction) {
    return 'production'
  }
  if (form.isTest) {
    return 'test'
  }
  if (form.isLocal) {
    return 'local'
  }
  return ''
})

/**
 * 切换环境标识：勾选一个即清掉其它两个，再次点击已勾选的则取消标记。
 * 后端保存时也会再归一一次，避免脏数据同时挂多个环境标签。
 */
function toggleEnv(env: Exclude<ConnectionEnv, ''>, checked: boolean) {
  const next = checked ? env : ''
  form.isLocal = next === 'local'
  form.isTest = next === 'test'
  form.isProduction = next === 'production'
}

/** 切换数据库类型时同步默认端口 */
function handleTypeChange(type: string) {
  form.port = DEFAULT_PORTS[type] ?? form.port
}

/** 进入「新建」状态：清空表单并回到基本页 */
function startCreate() {
  Object.assign(form, createEmptyForm())
  editingId.value = 0
  activeTab.value = 'basic'
}

/** 把某个连接载入右侧详情 */
function selectConnection(conn: DBConnection) {
  // 老数据可能没有后加的列（后端已用默认值兜底，这里再补一层，避免输入框出现 undefined）
  Object.assign(form, {
    ...createEmptyForm(),
    ...conn,
    // 已保存的密码不回填：留空即表示不修改
    password: '',
    connectTimeoutSecs: conn.connectTimeoutSecs || 10,
    queryTimeoutSecs: conn.queryTimeoutSecs || 60,
    keepaliveSecs: conn.keepaliveSecs || 30,
    sslMode: conn.sslMode || 'disable',
  })
  editingId.value = conn.id
  activeTab.value = 'basic'
}

/**
 * 构造提交给后端的表单副本。
 *
 * 密码框留空表示「不修改」：正在编辑已有连接时取回已保存的密文（`enc:` 前缀）补上——
 * 后端对 `enc:` 开头的密码不会再加密，可直接解密使用。
 * 否则测试连接会带着空密码去连（必然失败），保存还会把已存密码写空。
 */
async function buildPayload(): Promise<DBConnection> {
  const payload = { ...form } as DBConnection
  if (!payload.password && editingId.value) {
    payload.password = (await fetchConnection(editingId.value)).password
  }
  return payload
}

/**
 * 查看 / 刷新元数据前的校验：必须已保存连接。
 * 元数据接口按连接 ID 读取已保存的连接配置，未保存的连接没有 ID 可用。
 */
function requireSavedConnection(): DBConnection | null {
  const conn = savedConnection.value
  if (!conn) {
    ElMessage.warning('请先保存连接，再查看或刷新元数据')
  }
  return conn
}

/** 打开元数据查看弹窗（库 / 表 / 字段） */
function handleViewMetadata() {
  if (requireSavedConnection()) {
    metadataVisible.value = true
  }
}

/** 刷新该连接的元数据：清缓存后重新拉取库列表与当前库的表列表 */
async function handleRefreshMetadata() {
  const conn = requireSavedConnection()
  if (!conn) {
    return
  }
  metadataRefreshing.value = true
  try {
    // 库以表单里填写的为准（未填时用连接自身配置的库）
    await metadataStore.refreshConnection(conn.id, form.database || conn.database || '')
    ElMessage.success('元数据已刷新')
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
  finally {
    metadataRefreshing.value = false
  }
}

/** 测试连接（未改密码时用已保存的密码） */
async function handleTest() {
  testing.value = true
  try {
    await testConnection(await buildPayload())
    ElMessage.success('连接成功')
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
  finally {
    testing.value = false
  }
}

/** 保存连接 */
async function handleSave() {
  // 保存中忽略重复触发（快捷键连按 / 连点按钮）
  if (saving.value) {
    return
  }
  if (!form.name.trim()) {
    // 名称在「基本」页：校验失败先切过去，否则用户在别的页签上看不到要填什么
    activeTab.value = 'basic'
    ElMessage.warning('请输入连接名称')
    return
  }
  saving.value = true
  try {
    const id = await persistConnection(await buildPayload())
    ElMessage.success('保存成功')
    await load()
    // 新建成功后停在刚保存的这条上（editingId 从 0 变成新 ID）
    const saved = connections.value.find(item => item.id === id)
    if (saved) {
      selectConnection(saved)
    }
    notifyChanged()
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
  finally {
    saving.value = false
  }
}

/** 删除连接 */
async function handleDelete(conn: DBConnection) {
  try {
    await ElMessageBox.confirm(
      `确定删除连接「${conn.name}」吗？其下的 SQL 模板也会一并删除。`,
      '删除连接',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
    await removeConnection(conn.id)
    ElMessage.success('已删除')
    await load()
    // 删掉的正是当前编辑项时，回落到列表首项（没有就进入新建）
    if (editingId.value === conn.id) {
      const next = connections.value[0]
      if (next) {
        selectConnection(next)
      }
      else {
        startCreate()
      }
    }
    notifyChanged()
  }
  catch (e) {
    // 用户取消时不提示
    if (e !== 'cancel') {
      ElMessage.error(e instanceof Error ? e.message : String(e))
    }
  }
}

/**
 * Ctrl/Cmd + S 保存当前连接。
 *
 * 顺手拦掉浏览器的「保存网页」默认行为；
 * 视图是切换即卸载的（非 keep-alive），所以不会在别的标签页误触发。
 */
function handleSaveShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') {
    return
  }
  event.preventDefault()
  void handleSave()
}

onMounted(async () => {
  window.addEventListener('keydown', handleSaveShortcut)
  try {
    await load()
    // 默认展示第一条连接；没有任何连接时进入新建
    const first = connections.value[0]
    if (first) {
      selectConnection(first)
    }
    else {
      startCreate()
    }
  }
  finally {
    // 失败也要上报，否则遮罩会一直盖住界面
    emit('ready')
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleSaveShortcut)
})
</script>

<template>
  <div class="conn-workspace">
    <div class="conn-mgr">
      <!-- 左：连接列表 -->
      <aside class="conn-mgr__list">
        <div class="conn-mgr__list-head">
          <span>连接列表</span>
          <el-button size="small" type="primary" @click="startCreate">
            <el-icon><Plus /></el-icon>
            <span>新建</span>
          </el-button>
        </div>

        <ul v-loading="loading" class="conn-mgr__items">
          <li
            v-for="item in connections"
            :key="item.id"
            class="conn-mgr__item"
            :class="{ 'is-active': item.id === editingId }"
            :title="item.note || item.name"
            @click="selectConnection(item)"
          >
            <div class="conn-mgr__item-main">
              <span class="conn-mgr__item-name">
                <span v-if="item.color" class="conn-mgr__dot" :style="{ background: item.color }" />
                <span class="conn-mgr__item-text">{{ item.name }}</span>
                <el-tag v-if="item.isLocal" size="small" type="success" effect="plain">本地</el-tag>
                <el-tag v-if="item.isTest" size="small" type="warning" effect="plain">测试</el-tag>
                <el-tag v-if="item.isProduction" size="small" type="danger" effect="plain">生产</el-tag>
                <el-tag v-if="item.readOnly" size="small" type="info" effect="plain">只读</el-tag>
              </span>
              <span class="conn-mgr__item-addr">
                {{ item.dbType }} · {{ item.host }}:{{ item.port }}/{{ item.database }}
              </span>
            </div>
            <el-icon
              class="conn-mgr__item-del"
              title="删除"
              @click.stop="handleDelete(item)"
            >
              <Delete />
            </el-icon>
          </li>

          <li v-if="!connections.length && !loading" class="conn-mgr__empty">
            暂无连接，点击新建创建
          </li>
        </ul>
      </aside>

      <!-- 右：选中连接的详情（基本 / 高级 / SSL，与弹窗里的分页一致） -->
      <section class="conn-mgr__editor">
        <header class="conn-mgr__editor-head">
          <span class="conn-mgr__editor-title">
            {{ editingId ? '编辑连接' : '新建连接' }}
          </span>
          <small class="conn-mgr__editor-note">密码加密保存在本地，留空表示不修改</small>

          <div class="conn-mgr__editor-actions">
            <!-- 元数据：查看（放大镜）/ 刷新，放在「测试连接」左边 -->
            <el-button
              :disabled="!editingId"
              title="查看元数据（库 / 表 / 字段）"
              @click="handleViewMetadata"
            >
              <el-icon><Search /></el-icon>
            </el-button>
            <el-button
              :disabled="!editingId"
              :loading="metadataRefreshing"
              title="刷新元数据"
              @click="handleRefreshMetadata"
            >
              <el-icon><Refresh /></el-icon>
            </el-button>

            <el-button :loading="testing" @click="handleTest">测试连接</el-button>
            <el-button
              type="primary"
              :loading="saving"
              title="保存（Ctrl+S）"
              @click="handleSave"
            >
              保存
            </el-button>
          </div>
        </header>

        <el-form :label-width="100" label-position="right" class="conn-mgr__form">
          <el-tabs v-model="activeTab" class="conn-mgr__tabs">
            <!-- 基本：连接地址与账号 -->
            <el-tab-pane label="基本" name="basic">
              <el-form-item label="名称" required>
                <el-input v-model="form.name" placeholder="如：生产库" />
              </el-form-item>

              <el-form-item label="类型" required>
                <el-select v-model="form.dbType" style="width: 100%" @change="handleTypeChange">
                  <el-option
                    v-for="item in DB_TYPES"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value"
                  />
                </el-select>
              </el-form-item>

              <el-form-item label="主机">
                <el-input v-model="form.host" placeholder="127.0.0.1" />
              </el-form-item>

              <el-form-item label="端口">
                <el-input-number v-model="form.port" :min="1" :max="65535" controls-position="right" />
              </el-form-item>

              <el-form-item label="数据库">
                <el-input v-model="form.database" />
              </el-form-item>

              <el-form-item label="用户名">
                <el-input v-model="form.username" />
              </el-form-item>

              <el-form-item label="密码">
                <!-- 只保留输入框自带的「眼睛」切换明文 -->
                <el-input
                  v-model="form.password"
                  type="password"
                  placeholder="留空沿用已保存密码"
                  show-password
                />
              </el-form-item>

              <el-form-item label="备注">
                <el-input v-model="form.note" placeholder="可选，连接列表悬停展示" />
              </el-form-item>

              <el-form-item label="标记">
                <div class="conn-form__markers">
                  <el-color-picker v-model="form.color" />

                  <!-- 环境标识：三者互斥，生产在最右 -->
                  <el-checkbox
                    :model-value="envMark === 'local'"
                    @change="(value: boolean | string | number) => toggleEnv('local', Boolean(value))"
                  >
                    本地库
                  </el-checkbox>
                  <el-checkbox
                    :model-value="envMark === 'test'"
                    @change="(value: boolean | string | number) => toggleEnv('test', Boolean(value))"
                  >
                    测试库
                  </el-checkbox>
                  <el-checkbox
                    :model-value="envMark === 'production'"
                    @change="(value: boolean | string | number) => toggleEnv('production', Boolean(value))"
                  >
                    生产库
                  </el-checkbox>

                  <el-checkbox v-model="form.readOnly">只读连接</el-checkbox>
                </div>
              </el-form-item>
              <p class="conn-form__tip">
                颜色用于列表着色区分环境；本地 / 测试 / 生产为互斥的环境标识；
                只读连接会在后端拒绝执行写操作。
              </p>
            </el-tab-pane>

            <!-- 高级：方言、超时与自定义参数 -->
            <el-tab-pane label="高级" name="advanced">
              <el-form-item v-if="form.dbType === 'mysql'" label="字符集">
                <el-input v-model="form.charset" placeholder="默认 utf8mb4" />
              </el-form-item>
              <el-form-item v-else label="默认模式">
                <el-input v-model="form.defaultSchema" placeholder="如 public，留空用连接默认 search_path" />
              </el-form-item>

              <el-form-item label="连接超时">
                <el-input-number v-model="form.connectTimeoutSecs" :min="1" :max="600" controls-position="right" />
                <span class="conn-form__unit">秒（默认 10）</span>
              </el-form-item>

              <el-form-item label="查询超时">
                <el-input-number v-model="form.queryTimeoutSecs" :min="1" :max="3600" controls-position="right" />
                <span class="conn-form__unit">秒（默认 60）</span>
              </el-form-item>

              <el-form-item label="空闲回收">
                <el-input-number v-model="form.keepaliveSecs" :min="1" :max="3600" controls-position="right" />
                <span class="conn-form__unit">秒（默认 30）</span>
              </el-form-item>

              <el-form-item label="附加参数">
                <el-input
                  v-model="form.urlParams"
                  type="textarea"
                  :rows="3"
                  placeholder="key=value&key2=value2，同名参数会覆盖上面的默认值"
                />
              </el-form-item>
            </el-tab-pane>

            <!-- SSL：单独一页，标签上的小圆点表示已启用 -->
            <el-tab-pane name="ssl">
              <template #label>
                <span class="conn-form__tab">
                  SSL
                  <span v-if="form.sslMode !== 'disable'" class="conn-form__tab-dot" />
                </span>
              </template>

              <el-form-item label="SSL 模式">
                <el-select v-model="form.sslMode" style="width: 100%">
                  <el-option
                    v-for="item in SSL_MODES"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value"
                  />
                </el-select>
              </el-form-item>

              <template v-if="form.sslMode !== 'disable'">
                <el-form-item label="CA 证书">
                  <el-input v-model="form.sslCaPath" placeholder="verify-ca / verify-full 时需要，如 /etc/ssl/ca.pem" />
                </el-form-item>
                <el-form-item label="客户端证书">
                  <el-input v-model="form.sslCertPath" placeholder="双向认证时填写，如 /etc/ssl/client.pem" />
                </el-form-item>
                <el-form-item label="客户端私钥">
                  <el-input v-model="form.sslKeyPath" placeholder="双向认证时填写，如 /etc/ssl/client.key" />
                </el-form-item>
              </template>

              <p class="conn-form__tip conn-form__tip--ssl">
                {{ sslHint }}
              </p>
            </el-tab-pane>
          </el-tabs>
        </el-form>
      </section>
    </div>

    <!-- 元数据查看：库 / 表 / 字段 -->
    <ConnectionMetadataDialog
      v-model:visible="metadataVisible"
      :connection="savedConnection"
    />
  </div>
</template>

<style scoped>
/* 标签页内：内容铺满可用区域，各分区内部自行滚动 */
.conn-workspace {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.conn-mgr {
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
.conn-mgr__list {
  display: flex;
  flex-direction: column;
  flex: 0 0 260px;
  min-height: 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.conn-mgr__list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  font-size: var(--app-font-size);
  font-weight: 600;
}

.conn-mgr__items {
  flex: 1;
  margin: 0;
  padding: 6px;
  list-style: none;
  overflow: auto;
}

.conn-mgr__item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.conn-mgr__item:hover {
  background: var(--hover-bg);
}

.conn-mgr__item.is-active {
  background: var(--active-bg);
}

.conn-mgr__item-main {
  flex: 1;
  min-width: 0;
}

.conn-mgr__item-name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: var(--app-font-size);
}

.conn-mgr__item-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conn-mgr__item-addr {
  display: block;
  margin-top: 3px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--app-font-size-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 颜色点：环境标记，与表单里的颜色选择器同一取值 */
.conn-mgr__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.conn-mgr__item-del {
  flex: 0 0 auto;
  opacity: 0;
  color: var(--text-muted);
}

.conn-mgr__item:hover .conn-mgr__item-del {
  opacity: 1;
}

.conn-mgr__item-del:hover {
  color: var(--danger-color);
}

.conn-mgr__empty {
  padding: 20px 10px;
  color: var(--text-muted);
  font-size: var(--app-font-size-sm);
  text-align: center;
}

/* 右侧详情：头部固定，页签区吃掉剩余空间 */
.conn-mgr__editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  gap: 10px;
  overflow: hidden;
}

.conn-mgr__editor-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.conn-mgr__editor-title {
  font-size: var(--app-font-size-lg);
  font-weight: 600;
}

.conn-mgr__editor-note {
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
}

/* 操作按钮靠最右侧 */
.conn-mgr__editor-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

/* Element Plus 会给相邻按钮加 12px 外边距，与这里的 gap 叠加后间距不均 */
.conn-mgr__editor-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.conn-mgr__form {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* 页签区：外框 + 表头固定 + 内容区内部滚动 */
.conn-mgr__tabs {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.conn-mgr__tabs :deep(.el-tabs__header) {
  flex: 0 0 auto;
  margin: 0;
  padding: 6px 12px 0;
  border-bottom: 1px solid var(--border-color);
}

.conn-mgr__tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px 16px;
}

/* 标记行：颜色选择器与两个开关放在一行 */
.conn-form__markers {
  display: flex;
  align-items: center;
  gap: 16px;
}

.conn-form__tip {
  /* 与 el-form 的 label-width 对齐（见模板上的 :label-width="100"） */
  margin: -6px 0 10px 100px;
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
}

/* SSL 页的说明段落没有表单项在前，单独去掉左缩进 */
.conn-form__tip--ssl {
  margin-left: 0;
  line-height: 1.6;
}

/* SSL 页签：启用后带一个小圆点，切换页签前也能看出状态 */
.conn-form__tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.conn-form__tab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-success, #67c23a);
}

.conn-form__unit {
  margin-left: 8px;
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
}
</style>
