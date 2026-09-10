<script setup lang="ts">
/**
 * 无边框窗口的缩放宽边热区。
 *
 * 背景：Wails 内置的边缘缩放通过 `document.documentElement.style.cursor`
 * 设置指针样式，但自定义标题栏里的窗口按钮声明了 `cursor: pointer`，
 * 元素自身规则优先级高于从 html 继承的值，导致鼠标移到「右上角」这类
 * 与按钮重叠的边缘区域时，指针不会变成 NE 缩放样式。
 *
 * 方案：在窗口四周铺一层透明的边缘热区（位于最上层）。
 *   - 命中热区时，元素自身不声明 cursor，从而继承 html 上由 Wails 设置的缩放指针；
 *   - 同时声明 `--wails-draggable: no-drag`，避免在边缘按下时触发窗口拖动
 *     （Wails 的 mousedown 处理里 resizeEdge 优先于拖动，但拖动的 CSS 检测
 *      会先命中标题栏，这里显式关掉更稳妥）；
 * 热区厚度略小于 Wails 的判定阈值（默认 6px），保证视觉与行为一致。
 */

/** 与 Wails flags.borderThickness（6px）配合，略小 1px 避免遮挡内部内容 */
const EDGE_SIZE = 5
</script>

<template>
  <!-- 纯装饰性热区，不参与可访问性树 -->
  <div class="resize-edges" aria-hidden="true">
    <div class="resize-edges__item resize-edges__item--top" :style="{ height: `${EDGE_SIZE}px` }" />
    <div class="resize-edges__item resize-edges__item--bottom" :style="{ height: `${EDGE_SIZE}px` }" />
    <div class="resize-edges__item resize-edges__item--left" :style="{ width: `${EDGE_SIZE}px` }" />
    <div class="resize-edges__item resize-edges__item--right" :style="{ width: `${EDGE_SIZE}px` }" />
  </div>
</template>

<style scoped>
.resize-edges {
  position: fixed;
  inset: 0;
  /* 必须高于标题栏（z-index: 30），否则无法覆盖标题栏边缘 */
  z-index: 100;
  /* 容器本身不拦截鼠标，仅其子元素热区生效 */
  pointer-events: none;
}

.resize-edges__item {
  position: absolute;
  pointer-events: auto;
  /*
   * 不声明 cursor：继承 html 上由 Wails 设置的缩放指针。
   * 不参与拖动：边缘按下时交由 Wails 的 resizeEdge 逻辑处理。
   */
  --wails-draggable: no-drag;
}

.resize-edges__item--top {
  top: 0;
  left: 0;
  right: 0;
}

.resize-edges__item--bottom {
  bottom: 0;
  left: 0;
  right: 0;
}

.resize-edges__item--left {
  top: 0;
  bottom: 0;
  left: 0;
}

.resize-edges__item--right {
  top: 0;
  bottom: 0;
  right: 0;
}
</style>
