<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { fetchAppInfo, greet } from '@/api/app'
import type { AppInfo } from '@/api/app'
import type { InfoItem } from '@/types'
import InfoCard from '@/components/InfoCard.vue'
import logoUrl from '@/assets/images/logo-universal.png'

const name = ref('Wails')
const info = ref<AppInfo | null>(null)
const greeting = ref('')
const loading = ref(false)
const error = ref('')

async function loadAppInfo() {
  try {
    info.value = await fetchAppInfo()
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function handleGreet() {
  const value = name.value.trim()
  if (!value || loading.value) {
    return
  }
  loading.value = true
  error.value = ''
  try {
    greeting.value = await greet(value)
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
  finally {
    loading.value = false
  }
}

onMounted(loadAppInfo)

const infoItems = computed<InfoItem[]>(() => {
  const data = info.value
  if (!data) {
    return []
  }
  return [
    { label: '应用', value: `${data.name} v${data.version}` },
    { label: 'Go 版本', value: data.goVersion },
    { label: '运行平台', value: `${data.platform} / ${data.arch}` },
    { label: '前端框架', value: 'Vue 3 + Vite' },
  ]
})
</script>

<template>
  <main class="welcome">
    <header class="welcome__header">
      <img class="welcome__logo" :src="logoUrl" alt="Toolbox logo">
      <h1 class="welcome__title">Toolbox</h1>
      <p class="welcome__subtitle">基于 Wails + Vue 3 + TypeScript 的桌面工具箱脚手架</p>
      <div class="welcome__tags">
        <span class="welcome__tag">Wails v2</span>
        <span class="welcome__tag">Go</span>
        <span class="welcome__tag">Vue 3</span>
        <span class="welcome__tag">TypeScript</span>
        <span class="welcome__tag">Vite</span>
      </div>
    </header>

    <section class="welcome__body">
      <InfoCard title="运行环境" :items="infoItems" />

      <section class="welcome__panel">
        <h3 class="welcome__panel-title">试试前后端调用</h3>
        <p class="welcome__panel-desc">输入名字，调用 Go 后端的 Greet 方法</p>
        <div class="welcome__panel-row">
          <input
            v-model="name"
            class="welcome__input"
            placeholder="请输入名字"
            @keydown.enter="handleGreet"
          >
          <button class="welcome__button" :disabled="loading" @click="handleGreet">
            {{ loading ? '调用中…' : 'Greet' }}
          </button>
        </div>
        <p v-if="greeting" class="welcome__result">{{ greeting }}</p>
        <p v-if="error" class="welcome__error">{{ error }}</p>
      </section>
    </section>

    <footer class="welcome__footer">
      <code>npm run dev:app</code> 启动桌面应用 · <code>npm run dev</code> 仅启动前端调试
    </footer>
  </main>
</template>

<style scoped>
.welcome {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 40px;
  padding: 48px 40px 28px;
}

.welcome__header {
  text-align: center;
}

.welcome__logo {
  width: 96px;
  height: 96px;
}

.welcome__title {
  margin: 16px 0 8px;
  font-size: 40px;
  font-weight: 700;
  background: linear-gradient(120deg, #38bdf8, #6366f1 60%, #a855f7);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.welcome__subtitle {
  margin: 0;
  color: var(--text-muted);
  font-size: 15px;
}

.welcome__tags {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
}

.welcome__tag {
  padding: 4px 12px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--surface-color);
  color: var(--text-muted);
  font-size: 12px;
}

.welcome__body {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  width: min(920px, 100%);
}

.welcome__panel {
  flex: 1 1 320px;
  padding: 22px 24px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--surface-color);
  box-shadow: var(--shadow-md);
}

.welcome__panel-title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
}

.welcome__panel-desc {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}

.welcome__panel-row {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.welcome__input {
  flex: 1;
  padding: 9px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: rgba(15, 23, 42, 0.6);
  color: var(--text-color);
  font-size: 13px;
  outline: none;
}

.welcome__input:focus {
  border-color: var(--brand-color);
}

.welcome__button {
  padding: 0 18px;
  border: none;
  border-radius: var(--radius-md);
  background: linear-gradient(120deg, var(--brand-color), var(--brand-color-strong));
  color: #0b1120;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.welcome__button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.welcome__result {
  margin: 14px 0 0;
  color: var(--brand-color);
  font-size: 13px;
}

.welcome__error {
  margin: 14px 0 0;
  color: var(--danger-color);
  font-size: 13px;
}

.welcome__footer {
  margin-top: auto;
  color: var(--text-muted);
  font-size: 12px;
}

.welcome__footer code {
  font-family: var(--font-mono);
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--surface-color);
}
</style>
