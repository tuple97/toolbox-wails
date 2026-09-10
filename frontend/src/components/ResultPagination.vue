<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  /** 当前页码，从 1 开始 */
  page: number
  /** 每页条数 */
  pageSize: number
  /** 数据总量 */
  total: number
  /** 总页数 */
  pageCount: number
  /** 是否正在查询，用于禁用按钮避免重复提交 */
  loading?: boolean
}>(), {
  loading: false,
})

const emit = defineEmits<{
  (e: 'change', page: number): void
}>()

/** 跳转输入框的临时页码 */
const jumpPage = ref(props.page)

/** 结果变化后同步跳转框，避免停留在已失效的页码 */
watch(() => props.page, value => {
  jumpPage.value = value
})

/** 把页码约束到有效区间后上报 */
function go(target: number) {
  const max = props.pageCount > 0 ? props.pageCount : 1
  const next = Math.min(Math.max(Math.trunc(target) || 1, 1), max)
  if (next === props.page) {
    return
  }
  emit('change', next)
}
</script>

<template>
  <div class="result-pagination">
    <span class="result-pagination__info">
      共 {{ total }} 条 · 第 {{ page }} / {{ pageCount }} 页 · 每页 {{ pageSize }} 条
    </span>

    <div class="result-pagination__actions">
      <el-button size="small" :disabled="loading || page <= 1" @click="go(1)">
        首页
      </el-button>
      <el-button size="small" :disabled="loading || page <= 1" @click="go(page - 1)">
        上一页
      </el-button>
      <el-button size="small" :disabled="loading || page >= pageCount" @click="go(page + 1)">
        下一页
      </el-button>
      <el-button size="small" :disabled="loading || page >= pageCount" @click="go(pageCount)">
        尾页
      </el-button>

      <span class="result-pagination__jump-label">跳至</span>
      <el-input-number
        v-model="jumpPage"
        class="result-pagination__jump-input"
        :min="1"
        :max="pageCount > 0 ? pageCount : 1"
        size="small"
        controls-position="right"
        @keydown.enter.prevent="go(jumpPage)"
      />
      <span class="result-pagination__jump-label">页</span>
      <el-button
        size="small"
        type="primary"
        :disabled="loading"
        @click="go(jumpPage)"
      >
        跳转
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.result-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 16px 10px;
  border-top: 1px solid var(--border-color);
}

.result-pagination__info {
  color: var(--text-muted);
  font-size: 12px;
}

.result-pagination__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.result-pagination__jump-label {
  color: var(--text-muted);
  font-size: 12px;
}

.result-pagination__jump-input {
  width: 88px;
}
</style>
