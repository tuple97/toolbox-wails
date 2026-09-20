<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Button from '@/components/ui/Button.vue'
import Combobox from '@/components/ui/Combobox.vue'
import NumberInput from '@/components/ui/NumberInput.vue'
import { notify } from '@/utils/notify'

const props = withDefaults(defineProps<{
  /** 当前页码，从 1 开始 */
  page: number
  /** 每页条数；0 表示不分页 */
  pageSize: number
  /** 数据总量 */
  total: number
  /** 总页数 */
  pageCount: number
  /**
   * 后端是否真的按分页执行了本次查询。
   * 有些语句（SHOW / DESCRIBE / EXPLAIN 等）无法拼 LIMIT / OFFSET，
   * 此时保持用户设定的页大小，但翻页按钮不可用，并给出说明。
   */
  supported?: boolean
  /** 本次查询耗时（ms），显示在左侧信息最前面 */
  elapsedMs?: number
  /** 是否正在查询，用于禁用按钮避免重复提交 */
  loading?: boolean
}>(), {
  supported: true,
  elapsedMs: 0,
  loading: false,
})

const emit = defineEmits<{
  (e: 'change', page: number): void
  (e: 'size-change', pageSize: number): void
}>()

/** 可选的每页条数（下拉里还会额外提供「不分页」，见 sizeOptions） */
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200, 500, 1000]

/**
 * 每页条数上限，与后端 maxPageSize 保持一致。
 * 上限外的输入在这里就收紧，避免「填了 5000 实际按 1000 查」的静默差异。
 */
const MAX_PAGE_SIZE = 1000

/** 跳转输入框的临时页码 */
const jumpPage = ref(props.page)

/**
 * 每页条数下拉项。
 *
 * 值的类型是字符串（Combobox 统一用 string 做 v-model），
 * 但**语义上都是数字**：提交时由 handleSizeChange 统一转成 number。
 */
const sizeOptions = computed(() => [
  { label: '不分页', value: '0' },
  ...PAGE_SIZE_OPTIONS.map(size => ({ label: `${size} 条/页`, value: String(size) })),
])

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

/**
 * 页大小变化：下拉预设与手动输入共用。
 *
 * 下拉支持直接输入数字（Combobox 的 allow-create 会原样给出字符串），
 * 0 表示不分页；非法输入与超上限的值在这里拦下。
 */
function handleSizeChange(value: unknown) {
  let size = Math.trunc(Number(value))
  if (!Number.isFinite(size) || size < 0) {
    notify.warning('每页条数请填不小于 0 的整数（0 表示不分页）')
    return
  }
  if (size > MAX_PAGE_SIZE) {
    notify.warning(`每页最多 ${MAX_PAGE_SIZE} 条，已按上限处理`)
    size = MAX_PAGE_SIZE
  }
  if (size === props.pageSize) {
    return
  }
  emit('size-change', size)
}
</script>

<template>
  <!--
    分页条：左侧统计、右侧翻页与页大小。
    一律用 flex + gap 排版（旧样式要靠 `:deep(.el-button + .el-button)` 抵消
    Element Plus 给相邻按钮加的外边距，那种「先加 12px 再减掉」的规则没有存在的必要了）。
  -->
  <div
    class="result-pagination flex flex-wrap items-center justify-between gap-3 border-t border-border
      px-4 pb-2.5 pt-2"
  >
    <!-- 左侧信息：耗时在最前，其次是总量与分页状态 -->
    <span class="flex items-center gap-1.5 text-sm text-muted">
      <span v-if="elapsedMs > 0" class="font-semibold text-text">
        耗时 {{ elapsedMs }} ms
      </span>
      <template v-if="!supported">
        <span v-if="elapsedMs > 0" class="text-border">·</span>
        共 {{ total }} 条 · 该语句不支持分页
      </template>
      <template v-else-if="pageSize > 0">
        <span v-if="elapsedMs > 0" class="text-border">·</span>
        共 {{ total }} 条 · 第 {{ page }} / {{ pageCount }} 页 · 每页 {{ pageSize }} 条
      </template>
      <template v-else>
        <span v-if="elapsedMs > 0" class="text-border">·</span>
        共 {{ total }} 条 · 不分页
      </template>
    </span>

    <div class="flex flex-wrap items-center gap-1.5">
      <!-- 翻页按钮与跳转仅在分页状态下可用 -->
      <template v-if="supported && pageSize > 0">
        <Button size="sm" variant="secondary" :disabled="loading || page <= 1" @click="go(1)">
          首页
        </Button>
        <Button size="sm" variant="secondary" :disabled="loading || page <= 1" @click="go(page - 1)">
          上一页
        </Button>
        <Button size="sm" variant="secondary" :disabled="loading || page >= pageCount" @click="go(page + 1)">
          下一页
        </Button>
        <Button size="sm" variant="secondary" :disabled="loading || page >= pageCount" @click="go(pageCount)">
          尾页
        </Button>

        <span class="ml-1 text-sm text-muted">跳至</span>
        <NumberInput
          v-model="jumpPage"
          size="sm"
          class="w-[88px]"
          :min="1"
          :max="pageCount > 0 ? pageCount : 1"
          @enter="go(jumpPage)"
        />
        <span class="text-sm text-muted">页</span>
        <Button size="sm" :disabled="loading" @click="go(jumpPage)">
          跳转
        </Button>
      </template>

      <!-- 页大小：预设可选、也能手输数字，0 表示不分页 -->
      <Combobox
        :model-value="String(pageSize)"
        :options="sizeOptions"
        size="sm"
        allow-create
        search-placeholder="输入条数…"
        class="ml-1 w-[124px]"
        @update:model-value="handleSizeChange"
      />
    </div>
  </div>
</template>
