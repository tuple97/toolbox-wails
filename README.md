# toolbox-wails

基于 [Wails v2](https://wails.io) + Vue 3 + TypeScript + Vite 的桌面工具箱脚手架。

## 技术栈

- 后端：Go + Wails v2（WebView2 渲染，无需内置浏览器）
- 前端：Vue 3（SFC）+ TypeScript + Vite

## 目录结构

```
toolbox-wails/
├── main.go                 # 应用入口：窗口配置、资源嵌入、绑定注册
├── wails.json              # Wails 项目配置
├── go.mod
├── app/                    # Go 后端
│   ├── app.go              # App 结构体、生命周期、对外方法
│   └── system.go           # 应用与运行环境信息
├── build/                  # 打包资源与构建产物（build/bin 不入库）
└── frontend/               # 前端工程
    ├── index.html
    ├── vite.config.ts
    ├── tsconfig.json
    ├── wailsjs/            # Wails 自动生成的绑定代码（请勿手动修改）
    └── src/
        ├── main.ts         # 前端入口
        ├── App.vue         # 根组件
        ├── api/            # 后端接口封装
        ├── components/     # 通用组件
        ├── views/          # 页面（欢迎页 Welcome.vue）
        ├── styles/         # 全局样式
        ├── types/          # 公共类型
        └── assets/         # 静态资源（图片 / 字体）
```

## 环境要求

- Go >= 1.23，并已安装 Wails CLI：`go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- Node >= 20.19 + pnpm >= 9（`corepack enable pnpm` 或 `npm i -g pnpm`）
- Windows 需 WebView2 Runtime（Windows 10/11 一般自带）

## 开发

前端使用 pnpm 管理依赖：所有包统一存放在 pnpm 全局 store（`~/.local/share/pnpm/store`，Windows 下为 `%LOCALAPPDATA%\pnpm\store`），项目 `node_modules` 内为硬链接/软链接，多个项目复用同一份文件，不会重复占用磁盘。

所有前端命令均在 `frontend` 目录下执行：

```bash
cd frontend
pnpm install
```

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 仅启动 Vite 前端开发服务器（浏览器访问 http://localhost:5173） |
| `pnpm dev:app` | 启动 Wails 桌面应用（前端 + 后端热重载） |
| `pnpm build` | 类型检查并构建前端产物到 `frontend/dist` |
| `pnpm build:app` | 构建前端并打包桌面应用到 `build/bin` |
| `pnpm preview` | 预览前端构建产物 |
| `pnpm typecheck` | 仅执行类型检查 |

也可在项目根目录直接执行 `wails dev` / `wails build`（wails.json 中的前端命令已配置为 pnpm）。

## 新增后端方法

在 `app` 包中为 `App` 添加导出方法，执行 `wails dev` 或 `wails build` 后会自动生成
`frontend/wailsjs/go/app/App.js` 及 `models.ts`，前端通过 `@/api/app` 封装调用即可。
