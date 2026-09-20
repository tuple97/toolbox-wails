<script setup lang="ts">
/**
 * 工作台首页：欢迎语 + 快捷入口 + 已打开标签 + 系统监控（ECharts）。
 *
 * 约定：
 *  - 视图初始化结束必须 emit('ready')（用 try/finally 保证失败也上报），
 *    否则 Workbench 的首次加载遮罩会一直盖住内容区；
 *  - ECharts 实例是重量级对象，必须放 shallowRef，且卸载时 dispose；
 *  - 图表的颜色从 CSS 变量读取（主题切换时重算），数据每 2 秒轮询后端。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import Icon from '@/components/ui/Icon.vue'
import { fetchSystemMetrics } from '@/api/system'
import type { SystemMetrics } from '@/api/system'
import { useConfigStore } from '@/stores/configStore'
import { useTabStore } from '@/stores/tabStore'
import { toolOf } from '@/utils/tools'
import type { ToolType } from '@/types'

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const emit = defineEmits<{ (e: 'ready'): void }>()

const tabStore = useTabStore()
const configStore = useConfigStore()

/** 工具图标名（注册表里没有对应工具时给问号图标，模板里就不必到处判空） */
function iconOf(type: string): string {
  return toolOf(type)?.icon ?? 'question'
}

// ---------------------------------------------------------------- 顶部

/** 当前日期（中文长格式） */
const today = computed(() =>
  new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }),
)

// ---------------------------------------------------------------- 快捷入口

interface QuickAction {
  type: ToolType
  label: string
  icon: string
  description: string
}

/** 四个常用入口：多例工具新建实例，单例工具跳转 */
const QUICK_ACTIONS: QuickAction[] = [
  { type: 'db-query', label: 'SQL 查询', icon: 'search', description: '按模板执行查询' },
  { type: 'command-executor', label: 'SQL 执行', icon: 'terminal', description: '自由编写并执行 SQL' },
  { type: 'connections', label: '连接管理', icon: 'link', description: '维护数据库连接' },
  { type: 'dictionary', label: '词典管理', icon: 'book', description: '维护本地词典数据' },
]

function openQuick(action: QuickAction) {
  tabStore.openTool(action.type, { newInstance: toolOf(action.type)?.multi ?? false })
}

// ---------------------------------------------------------------- 已打开的标签

/**
 * 已打开的标签（最多 5 个）。
 * 注意：tabStore 只维护打开顺序，没有「最近活跃时间」这类字段，
 * 这里按标签栏顺序取前 5 个，不虚构数据。
 */
const recentTabs = computed(() => tabStore.tabs.slice(0, 5))

function activateTab(id: number) {
  tabStore.setActive(id)
}

// ---------------------------------------------------------------- 系统监控

/** 最近一次采样（用于数值卡片） */
const metrics = ref<SystemMetrics | null>(null)
/** 曲线数据点上限：2 秒一个点，约 1 分钟窗口 */
const MAX_SAMPLES = 30
/** 图表数据：时间轴 + 系统内存百分比 + 应用内存 MB */
const samples = ref<{ time: string, memoryPercent: number, appMemory: number }[]>([])

const chartEl = ref<HTMLDivElement | null>(null)
/** ECharts 实例（重量级对象：必须 shallowRef，严禁普通 ref） */
const chart = shallowRef<echarts.ECharts | null>(null)
let resizeObserver: ResizeObserver | null = null
let timer: number | null = null
/** 防止上一次采样未返回就叠加下一次 */
let polling = false

/** 读取主题变量（主题切换后颜色会随之变化） */
function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/** 给十六进制颜色加透明度（CSS 变量里的品牌色是 #rrggbb） */
function withAlpha(color: string, alpha: number): string {
  const hex = color.trim()
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    const r = Number.parseInt(hex.slice(1, 3), 16)
    const g = Number.parseInt(hex.slice(3, 5), 16)
    const b = Number.parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return hex
}

function buildOption(): echarts.EChartsCoreOption {
  const brand = cssVar('--brand-color', '#6e79f4')
  const accent = cssVar('--accent-color', '#818cf8')
  const muted = cssVar('--text-muted', '#94a3b8')
  const text = cssVar('--text-color', '#e2e8f0')
  const border = cssVar('--border-color', 'rgba(255, 255, 255, 0.1)')
  const tooltipBg = cssVar('--overlay-bg', 'rgba(30, 42, 72, 0.92)')

  const axisLabel = { color: muted, fontSize: 11 }
  const splitLine = { lineStyle: { color: border, type: 'dashed' as const } }

  return {
    // 每 2 秒更新一次，关闭动画避免曲线抖动
    animation: false,
    grid: { left: 46, right: 46, top: 28, bottom: 24 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: tooltipBg,
      borderColor: border,
      textStyle: { color: text, fontSize: 12 },
    },
    legend: {
      right: 0,
      top: 0,
      icon: 'roundRect',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: muted, fontSize: 11 },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: samples.value.map(item => item.time),
      axisLine: { lineStyle: { color: border } },
      axisTick: { show: false },
      axisLabel: { ...axisLabel, showMaxLabel: true },
    },
    yAxis: [
      {
        type: 'value',
        name: '内存 %',
        max: 100,
        nameTextStyle: axisLabel,
        axisLabel: axisLabel,
        splitLine,
      },
      {
        type: 'value',
        name: '应用 MB',
        nameTextStyle: axisLabel,
        axisLabel: axisLabel,
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '系统内存',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: samples.value.map(item => item.memoryPercent),
        lineStyle: { width: 1.5, color: brand },
        itemStyle: { color: brand },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: withAlpha(brand, 0.28) },
              { offset: 1, color: withAlpha(brand, 0) },
            ],
          },
        },
      },
      {
        name: '应用内存',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        showSymbol: false,
        data: samples.value.map(item => item.appMemory),
        lineStyle: { width: 1.5, color: accent },
        itemStyle: { color: accent },
      },
    ],
  }
}

/** 重绘（主题切换与数据更新都走这里；notMerge 保证颜色立即生效） */
function renderChart() {
  chart.value?.setOption(buildOption(), true)
}

/** 采样一次；失败静默保留上一次数据（仪表盘不该因为一次采样失败而报错） */
async function sample() {
  if (polling) {
    return
  }
  polling = true
  try {
    const next = await fetchSystemMetrics()
    if (!next) {
      return
    }
    metrics.value = next
    const time = new Date(next.timestamp || Date.now()).toLocaleTimeString('zh-CN', { hour12: false })
    samples.value = [
      ...samples.value,
      { time, memoryPercent: next.memoryPercent, appMemory: next.appMemoryMB },
    ].slice(-MAX_SAMPLES)
    renderChart()
  }
  finally {
    polling = false
  }
}

/** 数值卡片：系统内存展示为「已用 / 总量 GB」 */
const memoryText = computed(() => {
  const value = metrics.value
  if (!value || !value.memoryTotalMB) {
    return '—'
  }
  return `${(value.memoryUsedMB / 1024).toFixed(1)} / ${(value.memoryTotalMB / 1024).toFixed(1)} GB`
})

onMounted(async () => {
  try {
    if (chartEl.value) {
      chart.value = echarts.init(chartEl.value)
      resizeObserver = new ResizeObserver(() => chart.value?.resize())
      resizeObserver.observe(chartEl.value)
      renderChart()
    }
    await sample()
    timer = window.setInterval(() => void sample(), 2000)
  }
  finally {
    // 失败也要上报，否则加载遮罩不会消失
    emit('ready')
  }
})

onBeforeUnmount(() => {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
  resizeObserver?.disconnect()
  resizeObserver = null
  chart.value?.dispose()
  chart.value = null
})

// 主题切换：重算图表颜色（实例不重建）
watch(() => configStore.theme, () => renderChart())
</script>

<template>
  <div class="home">
    <header class="home__header">
      <h1 class="home__title">欢迎使用 Toolbox</h1>
      <span class="home__date">{{ today }}</span>
    </header>

    <!-- 快捷入口 -->
    <section class="home__section">
      <h2 class="home__section-title">快捷操作</h2>
      <div class="home__quick">
        <button
          v-for="action in QUICK_ACTIONS"
          :key="action.type"
          class="home__card home__card--action"
          type="button"
          @click="openQuick(action)"
        >
          <Icon class="home__card-icon" :name="action.icon" />
          <span class="home__card-title">{{ action.label }}</span>
          <span class="home__card-desc">{{ action.description }}</span>
        </button>
      </div>
    </section>

    <div class="home__columns">
      <!-- 系统监控 -->
      <section class="home__section">
        <h2 class="home__section-title">系统监控</h2>
        <div class="home__stats">
          <div class="home__card home__stat">
            <span class="home__stat-label">应用内存</span>
            <span class="home__stat-value">
              {{ metrics ? `${metrics.appMemoryMB.toFixed(1)} MB` : '—' }}
            </span>
          </div>
          <div class="home__card home__stat">
            <span class="home__stat-label">系统内存</span>
            <span class="home__stat-value">{{ memoryText }}</span>
            <span class="home__stat-hint">
              {{ metrics ? `占用 ${metrics.memoryPercent.toFixed(0)}%` : '' }}
            </span>
          </div>
          <div class="home__card home__stat">
            <span class="home__stat-label">CPU</span>
            <span class="home__stat-value">
              {{ metrics ? `${metrics.cpuPercent.toFixed(0)}%` : '—' }}
            </span>
            <span class="home__stat-hint">
              {{ metrics ? `${metrics.cpuCount} 逻辑核心` : '' }}
            </span>
          </div>
        </div>
        <div ref="chartEl" class="home__chart" />
      </section>

      <!-- 已打开的标签 -->
      <section class="home__section">
        <h2 class="home__section-title">已打开的标签</h2>
        <ul v-if="recentTabs.length" class="home__tabs">
          <li
            v-for="tab in recentTabs"
            :key="tab.uid"
            class="home__card home__tab"
            :class="{ 'is-active': tab.id === tabStore.activeId }"
            @click="activateTab(tab.id)"
          >
            <Icon v-if="toolOf(tab.toolType)" class="home__tab-icon" :name="iconOf(tab.toolType)" />
            <span class="home__tab-name">{{ tab.name }}</span>
          </li>
        </ul>
        <p v-else class="home__empty">暂无打开的标签</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.home {
  height: 100%;
  padding: var(--space-5);
  overflow: auto;
}

.home__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
  max-width: 1280px;
  margin: 0 auto var(--space-5);
}

.home__title {
  margin: 0;
  font-size: var(--app-font-size-xl);
  font-weight: 600;
  color: var(--text-color);
}

.home__date {
  color: var(--text-muted);
  font-size: var(--app-font-size-sm);
}

.home__section {
  max-width: 1280px;
  margin: 0 auto var(--space-5);
}

.home__section-title {
  margin: 0 0 var(--space-3);
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
}

/* 卡片：无阴影，靠边框与悬浮描边区分层级 */
.home__card {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--surface-color);
  color: var(--text-color);
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.home__quick {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-3);
}

.home__card--action {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
  padding: var(--space-4);
  text-align: left;
  cursor: pointer;
}

.home__card--action:hover {
  border-color: var(--brand-color);
}

.home__card-icon {
  margin-bottom: var(--space-2);
  color: var(--brand-color);
  font-size: var(--app-font-size-xl);
}

.home__card-title {
  font-size: var(--app-font-size);
  font-weight: 600;
}

.home__card-desc {
  color: var(--text-muted);
  font-size: var(--app-font-size-xs);
}

.home__columns {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: var(--space-4);
  max-width: 1280px;
  margin: 0 auto;
}

.home__columns .home__section {
  margin-bottom: 0;
}

@media (max-width: 1080px) {
  .home__columns {
    grid-template-columns: minmax(0, 1fr);
  }
}

.home__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
}

.home__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-3) var(--space-4);
}

.home__stat-label {
  color: var(--text-muted);
  font-size: var(--app-font-size-2xs);
}

.home__stat-value {
  font-size: var(--app-font-size-lg);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.home__stat-hint {
  min-height: 1em;
  color: var(--text-muted);
  font-size: var(--app-font-size-2xs);
}

.home__chart {
  height: 220px;
  margin-top: var(--space-3);
}

.home__tabs {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.home__tab {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
}

.home__tab:hover {
  border-color: var(--brand-color);
}

.home__tab.is-active {
  border-color: var(--brand-color);
  background: var(--active-bg);
}

.home__tab-icon {
  color: var(--text-muted);
  font-size: var(--app-font-size-sm);
}

.home__tab-name {
  min-width: 0;
  overflow: hidden;
  font-size: var(--app-font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home__empty {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--app-font-size-sm);
}
</style>
