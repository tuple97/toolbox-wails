# Toolbox（toolbox-wails）

基于 [Wails v3](https://v3.wails.io) + Vue 3 + TypeScript 的 Windows 桌面效率工具箱，当前围绕「SQL 查询工作台」：模板化 SQL、变量表单、结果字段映射与词典翻译、执行日志。连接、模板、词典、界面偏好等全部数据存储在本地 SQLite，离线可用。

## 功能

- **工作台布局**：左侧菜单 + 顶部多标签。标签支持拖拽排序、双击重命名、锁定、右键批量关闭，重启后完整恢复；多例工具（SQL 查询）可同时打开多个实例。
- **SQL 查询**：选择模板与连接 → 变量表单（文本/下拉/多选/日期/滑块等，下拉支持用 SQL 动态取选项）→ 执行 → 结果表格（列宽/对齐/别名/字段映射）+ 分页 + 执行日志（Monaco）。
- **SQL 模板**：`{{变量}}` 占位（Go `text/template` 渲染），支持关键字模板与函数片段插入、前置/后置脚本（goja 执行，带语法校验）、变量配置与字段映射配置；模板更新对引用它的查询标签即时生效。
- **连接管理**：MySQL / PostgreSQL，连接测试，密码本地加密存储。
- **词典**：维护「原始值 → 可读文本」映射，供字段映射把查询结果翻译成可读文本。
- **设置**：四套主题、界面/编辑器字体与字号、控件大小、窗口背景透明度与磨砂、日志保留条数，修改即时生效并自动保存。
- **界面自定义**：侧边菜单与工具选择面板均支持拖动排序、隐藏菜单项（各自独立的配置，互不影响）。
- 无边框自定义标题栏、窗口背景透明/毛玻璃、启动防闪屏。

## 技术栈

- 后端：Go 1.25 + Wails v3（beta.20，WebView2 渲染）；SQLite（modernc.org/sqlite，纯 Go 无 CGO）；`text/template` 模板渲染；goja 执行脚本；数据库驱动 go-sql-driver/mysql、lib/pq。
- 前端：Vue 3（SFC）+ TypeScript + Vite 7 + pnpm 11；Element Plus、Monaco Editor（本地打包离线可用）、vue-draggable-plus。

## 目录结构

```
toolbox-wails/
├── main.go                     # 应用入口：服务注册、资源嵌入（go:embed all:frontend/dist）、主窗口配置
├── wails.json                  # Wails 项目配置（应用名、输出文件名）
├── go.mod
├── app/                        # Go 后端
│   ├── app.go                  # App 结构体：依赖装配、生命周期、退出通知
│   ├── bind_*.go               # 绑定层：db / dict / font / settings / tabs / template（仅校验+转发）
│   ├── window.go               # 窗口控制（最小化/最大化/关闭）
│   ├── fonts_windows.go        # 读取本机已安装字体（注册表）
│   └── internal/
│       ├── database/           # SQLite 访问（repository、连接管理、建表）
│       ├── services/           # 业务服务（连接/模板/词典/标签/设置）
│       ├── script/             # goja 前置/后置脚本引擎
│       └── utils/              # 模板渲染、加解密等
├── build/                      # 打包资源（icon.ico、manifest、info.json）与产物（build/bin 不入库）
└── frontend/                   # 前端工程
    ├── bindings/               # wails3 generate bindings 自动生成（勿手动修改）
    └── src/
        ├── api/                # 后端接口封装（显式类型映射）+ bindings.ts
        ├── components/         # 通用组件（标题栏、Monaco、结果表格、字段映射/变量配置面板等）
        ├── layouts/            # 工作台布局（左侧菜单 + 多标签）
        ├── stores/             # Pinia（标签/配置/词典/日志）
        ├── utils/              # 工具注册表、字体、模板语言等
        ├── views/tools/        # 各工具页面（SQL 查询/连接/模板/词典/设置）
        ├── styles/             # 全局样式与主题变量
        └── types/              # 公共类型
```

## 环境要求

- Go >= 1.25；Wails CLI v3：`go install github.com/wailsapp/wails/v3/cmd/wails3@latest`（生成绑定与图标用）
- Node >= 20.19 + pnpm >= 11（`corepack enable pnpm` 或 `npm i -g pnpm`）
- Windows 10/11，WebView2 Runtime（一般自带）

## 开发

```bash
cd frontend
pnpm install
```

所有前端命令均在 `frontend` 目录下执行：

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 仅启动 Vite 开发服务器（浏览器访问 http://localhost:5173） |
| `pnpm dev:app` | 启动桌面应用：Vite 开发服务器 + `go run .`（WebView 加载 dev server，改动热更新） |
| `pnpm build` | 类型检查（vue-tsc）并构建前端产物到 `frontend/dist` |
| `pnpm build:app` | `pnpm build` 后编译桌面应用到 `build/bin/toolbox.exe` |
| `pnpm gen:bindings` | 重新生成后端绑定到 `frontend/bindings` |
| `pnpm preview` / `pnpm typecheck` | 预览构建产物 / 仅类型检查 |

> 说明：页面资源在 Go 编译时通过 `go:embed all:frontend/dist` 嵌入，因此**打包必须先构建前端**（`build:app` 已包含）；开发模式加载的是 Vite 开发服务器，不受影响。

## 打包

```bash
cd frontend
pnpm build:app
build\bin\toolbox.exe
```

需要应用图标时，先在仓库根目录生成 `.syso` 再编译（不带 `-arch amd64` 会静默产出 0 字节文件，导致链接回退外部链接而报 gcc 错误）：

```bash
wails3 generate syso -arch amd64 -icon build\windows\icon.ico -manifest build\windows\wails.exe.manifest -info build\windows\info.json -out toolbox-wails.syso
```

## 数据存储

全部数据（连接、模板、词典、标签布局、界面设置）保存在本地 SQLite：

- 数据目录：`%AppData%\Toolbox\`（无法定位时回退到可执行文件同级目录）
- `toolbox.db`：连接、模板、词典、标签、设置；连接密码经本地密钥加密
- 同目录还存放连接密码的加密密钥文件

## 扩展

- **新增后端方法**：在 `app/bind_*.go` 添加方法（校验 + 转发到 `internal/services`），执行 `pnpm gen:bindings` 重新生成绑定，前端在 `src/api/*.ts` 封装后使用。
- **新增配置项**：三处同步——Go `defaultSettings`、前端 `configStore.DEFAULTS`、`types` 的 `SettingKey`。
- **新增工具**：`frontend/src/utils/tools.ts` 的 `TOOLS` 注册一项，`Workbench.vue` 加渲染分支，`views/tools/` 下新增视图；视图首次初始化结束时需 `emit('ready')`（父级据此关闭加载遮罩）。
