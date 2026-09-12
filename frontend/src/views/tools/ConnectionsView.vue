<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
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
  editVisible.value = true
}

function openEdit(conn: DBConnection) {
  Object.assign(form, { ...conn, password: '' })
  showPassword.value = false
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
      <el-table-column prop="name" label="名称" min-width="130" />
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
      width="520px"
      append-to-body
    >
      <el-form label-width="90px" label-position="right">
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
</style>
