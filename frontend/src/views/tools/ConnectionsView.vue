<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  fetchConnection,
  fetchConnections,
  persistConnection,
  removeConnection,
  revealPassword,
  testConnection,
} from '@/api/db'
import { Events } from '@wailsio/runtime'
import type { DBConnection } from '@/types'

/**
 * 连接管理（单例标签页）。
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

/** 编辑弹窗当前页签 */
const activeTab = ref('basic')

/** SSL 页的说明文案 */
const sslHint = computed(() => SSL_HINTS[form.sslMode] ?? SSL_HINTS.disable)

const connections = ref<DBConnection[]>([])
const loading = ref(false)
const testing = ref(false)
const saving = ref(false)

/** 编辑弹窗 */
const editVisible = ref(false)
const form = reactive<DBConnection>(createEmptyForm())

/** 密码是否以明文展示 */
const showPassword = ref(false)

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

/** 切换数据库类型时同步默认端口 */
function handleTypeChange(type: string) {
  form.port = DEFAULT_PORTS[type] ?? form.port
}

function openCreate() {
  Object.assign(form, createEmptyForm())
  showPassword.value = false
  activeTab.value = 'basic'
  editVisible.value = true
}

function openEdit(conn: DBConnection) {
  // 老数据可能没有后加的列（后端已用默认值兜底，这里再补一层，避免输入框出现 undefined）
  Object.assign(form, {
    ...createEmptyForm(),
    ...conn,
    password: '',
    connectTimeoutSecs: conn.connectTimeoutSecs || 10,
    queryTimeoutSecs: conn.queryTimeoutSecs || 60,
    keepaliveSecs: conn.keepaliveSecs || 30,
    sslMode: conn.sslMode || 'disable',
  })
  showPassword.value = false
  activeTab.value = 'basic'
  editVisible.value = true
}

/**
 * 查看密码明文。
 * 编辑已有连接时输入框为空（不修改则留空），
 * 因此需要先取回密文再交由后端解密。
 */
async function handleReveal() {
  if (showPassword.value) {
    // 已展示明文时再次点击则把输入框恢复为空，避免误提交明文
    form.password = ''
    showPassword.value = false
    return
  }

  if (form.password) {
    // 用户已手动输入，直接展示
    showPassword.value = true
    return
  }

  if (!form.id) {
    showPassword.value = true
    return
  }

  try {
    // 取回已保存的密文用于解密展示
    const saved = await fetchConnection(form.id)
    form.password = await revealPassword(saved.password)
    showPassword.value = true
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
}

/** 测试连接 */
async function handleTest() {
  testing.value = true
  try {
    await testConnection({ ...form } as DBConnection)
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
  if (!form.name.trim()) {
    // 名称在「基本」页：校验失败先切过去，否则用户在别的页签上看不到要填什么
    activeTab.value = 'basic'
    ElMessage.warning('请输入连接名称')
    return
  }
  saving.value = true
  try {
    await persistConnection({ ...form } as DBConnection)
    ElMessage.success('保存成功')
    editVisible.value = false
    await load()
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
    notifyChanged()
  }
  catch (e) {
    // 用户取消时不提示
    if (e !== 'cancel') {
      ElMessage.error(e instanceof Error ? e.message : String(e))
    }
  }
}

onMounted(async () => {
  try {
    await load()
  }
  finally {
    // 失败也要上报，否则遮罩会一直盖住界面
    emit('ready')
  }
})
</script>

<template>
  <div class="conn-view">
    <header class="conn-view__head">
      <div class="conn-view__title">
        <span class="conn-view__bar" aria-hidden="true" />
        <span>数据库连接管理</span>
        <small>新建、编辑与测试数据库连接；密码加密保存在本地</small>
      </div>

      <el-button type="primary" @click="openCreate">
        <el-icon><Plus /></el-icon>
        <span>新建连接</span>
      </el-button>
    </header>

    <el-table
      v-loading="loading"
      :data="connections"
      size="small"
      empty-text="暂无连接，请点击右上角新建"
    >
      <el-table-column label="名称" min-width="170">
        <template #default="{ row }">
          <span class="conn-view__name">
            <span v-if="row.color" class="conn-view__dot" :style="{ background: row.color }" />
            <span>{{ row.name }}</span>
            <el-tag v-if="row.isProduction" size="small" type="danger" effect="plain">生产</el-tag>
            <el-tag v-if="row.readOnly" size="small" type="warning" effect="plain">只读</el-tag>
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="dbType" label="类型" width="110" />
      <el-table-column label="地址" min-width="180">
        <template #default="{ row }">
          {{ row.host }}:{{ row.port }}/{{ row.database }}
        </template>
      </el-table-column>
      <el-table-column prop="username" label="用户名" width="120" />
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 编辑弹窗 -->
    <el-dialog
      v-model="editVisible"
      :title="form.id ? '编辑连接' : '新建连接'"
      width="640px"
      top="6vh"
      append-to-body
    >
      <el-form :label-width="100" label-position="right">
        <el-tabs v-model="activeTab" class="conn-form__tabs">
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
              <el-input
                v-model="form.password"
                :type="showPassword ? 'text' : 'password'"
                placeholder="留空表示不修改"
                show-password
              >
                <template #append>
                  <el-button @click="handleReveal">
                    {{ showPassword ? '隐藏' : '查看' }}
                  </el-button>
                </template>
              </el-input>
            </el-form-item>

            <el-form-item label="备注">
              <el-input v-model="form.note" placeholder="可选，连接列表悬停展示" />
            </el-form-item>

            <el-form-item label="标记">
              <div class="conn-form__markers">
                <el-color-picker v-model="form.color" />
                <el-checkbox v-model="form.isProduction">生产库</el-checkbox>
                <el-checkbox v-model="form.readOnly">只读连接</el-checkbox>
              </div>
            </el-form-item>
            <p class="conn-form__tip">
              颜色用于列表着色区分环境；只读连接会在后端拒绝执行写操作。
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

      <template #footer>
        <el-button :loading="testing" @click="handleTest">测试连接</el-button>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.conn-view {
  height: 100%;
  overflow: auto;
  padding: 16px 20px;
}

.conn-view__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.conn-view__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--app-font-size-lg);
  font-weight: 600;
}

.conn-view__bar {
  width: 3px;
  height: 15px;
  border-radius: 2px;
  background: var(--brand-color);
}

.conn-view__title small {
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
  font-weight: 400;
}

/* 名称列：颜色点 + 标记 */
.conn-view__name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.conn-view__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
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

.conn-form__tabs :deep(.el-tabs__header) {
  margin-bottom: 14px;
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
