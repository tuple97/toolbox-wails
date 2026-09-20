<script setup lang="ts">
/**
 * 确认框宿主（`utils/confirm.ts` 的渲染端）。
 *
 * 同样是「全局一个」：`askConfirm()` 可以在任意模块里被 await，
 * 包括纯 TS 模块（旧代码里 `utils/sql/rowSql.ts` 就用了 ElMessageBox）。
 *
 * 打开状态由「有没有待确认请求」派生，所以不存在两处状态不同步的问题；
 * 关闭一律走 `settleConfirm(false)`（等价于取消），Promise 不会悬空。
 */
import { computed, nextTick, ref, watch } from 'vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Icon from '@/components/ui/Icon.vue'
import { pendingConfirm, settleConfirm } from '@/utils/confirm'

const open = computed({
  get: () => pendingConfirm.value !== null,
  set: (value: boolean) => {
    if (!value) {
      settleConfirm(false)
    }
  },
})

/** 危险操作的语气（图标与确认按钮都跟着改） */
const danger = computed(() => pendingConfirm.value?.tone === 'danger')

const confirmRef = ref<InstanceType<typeof Button> | null>(null)

/*
 * 打开后把焦点放到确认按钮上：键盘用户 Tab / 回车即可确认，
 * Esc 取消（由 Dialog 处理）。不自动「焦点陷阱」闭环 —— 这是桌面端单窗口应用，
 * 焦点留在弹窗内靠视觉与 Esc 足够，过度拦截反而会吃掉编辑器的快捷键。
 */
watch(open, async (value) => {
  if (!value) {
    return
  }
  await nextTick()
  confirmRef.value?.$el?.focus?.()
})
</script>

<template>
  <Dialog v-model="open" :title="pendingConfirm?.title ?? ''" :width="420">
    <div class="flex items-start gap-3">
      <Icon
        name="alert-triangle"
        :class="['mt-0.5 text-xl', danger ? 'text-danger' : 'text-warning']"
      />
      <p class="text-sm leading-relaxed text-text">
        {{ pendingConfirm?.message }}
      </p>
    </div>

    <template #footer>
      <Button variant="secondary" size="sm" @click="settleConfirm(false)">
        {{ pendingConfirm?.cancelText }}
      </Button>
      <Button
        ref="confirmRef"
        :variant="danger ? 'danger' : 'default'"
        size="sm"
        @click="settleConfirm(true)"
      >
        {{ pendingConfirm?.confirmText }}
      </Button>
    </template>
  </Dialog>
</template>
