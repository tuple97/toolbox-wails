import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@wails': fileURLToPath(new URL('./wailsjs', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Monaco 体积较大，提高警告阈值避免噪音
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        // 把体积大的依赖拆包，避免单个 chunk 过大影响首屏
        manualChunks: {
          monaco: ['monaco-editor'],
          element: ['element-plus'],
        },
      },
    },
  },
  optimizeDeps: {
    // Element Plus 与拖拽库为预构建依赖，显式声明可加快冷启动。
    // 注意：monaco-editor 不能加入 include，其 worker 需由 Vite 按 ?worker
    // 方式单独处理，预构建会破坏 worker 的路径解析。
    include: ['element-plus', 'vue-draggable-plus'],
    exclude: ['monaco-editor'],
  },
  worker: {
    // Monaco worker 以 ES 模块格式打包，保证 import 语法在 worker 内可用
    format: 'es',
  },
})
