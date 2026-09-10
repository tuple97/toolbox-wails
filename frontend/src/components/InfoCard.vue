<script setup lang="ts">
import type { InfoItem } from '@/types'

withDefaults(defineProps<{
  title: string
  items?: InfoItem[]
}>(), {
  items: () => [],
})
</script>

<template>
  <section class="info-card">
    <h3 class="info-card__title">{{ title }}</h3>
    <ul v-if="items.length" class="info-card__list">
      <li v-for="item in items" :key="item.label" class="info-card__item">
        <span class="info-card__label">{{ item.label }}</span>
        <span class="info-card__value">{{ item.value }}</span>
      </li>
    </ul>
    <p v-else class="info-card__empty">加载中…</p>
  </section>
</template>

<style scoped>
.info-card {
  flex: 1 1 260px;
  padding: 22px 24px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--surface-color);
  box-shadow: var(--shadow-md);
}

.info-card__title {
  margin: 0 0 16px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
}

.info-card__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.info-card__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--border-color);
}

.info-card__item:last-child {
  border-bottom: none;
}

.info-card__label {
  color: var(--text-muted);
  font-size: 13px;
}

.info-card__value {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-color);
}

.info-card__empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
