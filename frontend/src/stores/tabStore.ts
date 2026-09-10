import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { fetchTabs, persistTabs } from '@/api/tabs'
import type { ToolType, WorkbenchTab } from '@/types'

/** 防抖保存间隔：state 变化后等待 1s 再落盘 */
const SAVE_DEBOUNCE_MS = 1000

/** 新建 Tab 的默认名称前缀 */
const DEFAULT_TAB_NAME = '新建标签'

export const useTabStore = defineStore('tabs', () => {
  /** 全部 Tab，顺序即为展示顺序 */
  const tabs = ref<WorkbenchTab[]>([])
  /** 当前激活的 Tab ID */
  const activeId = ref<number | null>(null)
  /** 是否已完成首次加载 */
  const loaded = ref(false)
  /** 保存状态，供界面提示 */
  const saving = ref(false)
  const lastSavedAt = ref<number | null>(null)
  const saveError = ref('')

  /** 自增主键：本地新建时分配临时 ID，避免与后端 AUTOINCREMENT 冲突 */
  let nextLocalId = -1

  /** 当前激活的 Tab */
  const activeTab = computed(
    () => tabs.value.find(tab => tab.id === activeId.value) ?? null,
  )

  /** 未锁定的 Tab 才可关闭 */
  const closableTabs = computed(() => tabs.value.filter(tab => !tab.isLocked))

  let saveTimer: number | null = null
  /** 保存请求是否在等待执行（用于保存期间再次变更的补偿） */
  let pendingAfterSave = false

  // ------------------------------------------------------------ 持久化

  /**
   * 规范化待保存数据：
   * 顺序即为 sortOrder，激活态以 activeId 为准。
   */
  function snapshot(): WorkbenchTab[] {
    return tabs.value.map((tab, index) => ({
      ...tab,
      sortOrder: index,
      isActive: tab.id === activeId.value,
    }))
  }

  /**
   * 立即保存（用于退出兜底与手动触发）。
   *
   * 后端会重新分配 ID（本地新建的标签为负数占位 ID），
   * 因此保存后需把返回值同步回本地，并把 activeId 映射到新 ID，
   * 否则后续操作会指向一个不存在的标签。
   *
   * 注意：只在 ID 真正发生变化时才替换本地数组。
   * 无条件替换会让 tabs 数组整体换引用，进而触发依赖它的组件重渲染，
   * 与「渲染 → 保存」形成循环。
   */
  async function saveNow(): Promise<void> {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer)
      saveTimer = null
    }
    saving.value = true
    saveError.value = ''
    try {
      // 记录保存前的激活位置，便于按索引映射回新 ID
      const activeIndex = tabs.value.findIndex(tab => tab.id === activeId.value)

      const saved = await persistTabs(snapshot())

      // 判断后端是否重新分配了 ID（仅本地新建的标签会出现这种情况）
      const idsChanged = saved.some((tab, index) => tab.id !== tabs.value[index]?.id)
      if (idsChanged) {
        tabs.value = saved
        activeId.value = saved[activeIndex]?.id ?? saved[0]?.id ?? null
      }

      lastSavedAt.value = Date.now()
    }
    catch (e) {
      saveError.value = e instanceof Error ? e.message : String(e)
    }
    finally {
      saving.value = false
      // 保存期间若有新的变更，再排一次保存，确保不丢数据
      if (pendingAfterSave) {
        pendingAfterSave = false
        scheduleSave()
      }
    }
  }

  /** 防抖保存：任意 state 变化后延迟落盘 */
  function scheduleSave() {
    // 若正在保存，标记需要追加一次保存，避免期间的改动被遗漏
    if (saving.value) {
      pendingAfterSave = true
      return
    }
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer)
    }
    saveTimer = window.setTimeout(() => {
      saveTimer = null
      void saveNow()
    }, SAVE_DEBOUNCE_MS)
  }

  // ------------------------------------------------------------ 加载

  /** 从后端加载 Tab 列表 */
  async function load(): Promise<void> {
    try {
      const list = await fetchTabs()
      // 后端按 sort_order 返回，这里再按字段显式排序确保顺序稳定
      tabs.value = [...list].sort((a, b) => a.sortOrder - b.sortOrder)

      const active = tabs.value.find(tab => tab.isActive)
      activeId.value = active?.id ?? tabs.value[0]?.id ?? null
      loaded.value = true
    }
    catch (e) {
      saveError.value = e instanceof Error ? e.message : String(e)
      loaded.value = true
    }
  }

  // ------------------------------------------------------------ 增删改

  /** 新建一个 Tab 并激活 */
  function addTab(toolType: ToolType = 'placeholder', name?: string): WorkbenchTab {
    const tab: WorkbenchTab = {
      id: nextLocalId--,
      name: name ?? `${DEFAULT_TAB_NAME} ${tabs.value.length + 1}`,
      sortOrder: tabs.value.length,
      isActive: false,
      isLocked: false,
      toolType,
      payload: '{}',
      schemaVersion: 1,
    }
    tabs.value.push(tab)
    activeId.value = tab.id
    scheduleSave()
    return tab
  }

  /**
   * 关闭 Tab。
   * 锁定状态下禁止关闭，避免误操作丢失配置。
   */
  function closeTab(id: number, options: { force?: boolean } = {}): boolean {
    const index = tabs.value.findIndex(tab => tab.id === id)
    if (index < 0) {
      return false
    }
    if (tabs.value[index].isLocked && !options.force) {
      return false
    }

    tabs.value.splice(index, 1)

    // 激活态处理：关闭的是当前 Tab 时，顺延到相邻项
    if (activeId.value === id) {
      const next = tabs.value[index] ?? tabs.value[index - 1] ?? null
      activeId.value = next?.id ?? null
    }
    scheduleSave()
    return true
  }

  /** 关闭除指定 Tab 外的其他 Tab（锁定项与自身保留） */
  function closeOthers(id: number): void {
    tabs.value = tabs.value.filter(tab => tab.id === id || tab.isLocked)
    activeId.value = id
    scheduleSave()
  }

  /** 关闭全部未锁定 Tab */
  function closeAll(): void {
    tabs.value = tabs.value.filter(tab => tab.isLocked)
    activeId.value = tabs.value[0]?.id ?? null
    scheduleSave()
  }

  /** 重命名 Tab */
  function renameTab(id: number, name: string): void {
    const trimmed = name.trim()
    if (!trimmed) {
      return
    }
    const tab = tabs.value.find(item => item.id === id)
    if (!tab) {
      return
    }
    tab.name = trimmed
    scheduleSave()
  }

  /** 切换锁定状态 */
  function toggleLock(id: number): void {
    const tab = tabs.value.find(item => item.id === id)
    if (!tab) {
      return
    }
    tab.isLocked = !tab.isLocked
    scheduleSave()
  }

  /** 切换激活 Tab */
  function setActive(id: number): void {
    if (activeId.value === id) {
      return
    }
    activeId.value = id
    scheduleSave()
  }

  /** 拖拽排序后更新顺序 */
  function reorder(newOrder: WorkbenchTab[]): void {
    tabs.value = newOrder
    scheduleSave()
  }

  /**
   * 为 Tab 绑定工具。
   * 依据 PRD：工具一旦选定即永久绑定，不支持再切换。
   */
  function bindTool(id: number, toolType: ToolType): boolean {
    const tab = tabs.value.find(item => item.id === id)
    if (!tab || tab.toolType !== 'placeholder') {
      return false
    }
    tab.toolType = toolType
    scheduleSave()
    return true
  }

  /**
   * 更新 Tab 的 payload（工具内部状态）。
   * 内容未变化时不赋值也不排保存，避免触发无意义的响应式更新与落盘。
   */
  function updatePayload(id: number, payload: unknown): void {
    const tab = tabs.value.find(item => item.id === id)
    if (!tab) {
      return
    }

    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload)
    if (tab.payload === serialized) {
      return
    }

    tab.payload = serialized
    scheduleSave()
  }

  return {
    // state
    tabs,
    activeId,
    loaded,
    saving,
    lastSavedAt,
    saveError,
    // getters
    activeTab,
    closableTabs,
    // actions
    load,
    saveNow,
    scheduleSave,
    addTab,
    closeTab,
    closeOthers,
    closeAll,
    renameTab,
    toggleLock,
    setActive,
    reorder,
    bindTool,
    updatePayload,
  }
})
