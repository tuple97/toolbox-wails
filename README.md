# Toolbox · 开发工具箱

> 面向日常开发者的 Windows 桌面工具箱：以「SQL 查询工作台」为核心，模板化 SQL、变量表单、结果字段映射与词典翻译、执行记录，数据全部落在本地 SQLite，离线可用。

[![Release](https://img.shields.io/github/v/release/tuple97/toolbox-wails?label=release&color=409eff)](https://github.com/tuple97/toolbox-wails/releases)
[![Downloads](https://img.shields.io/github/downloads/tuple97/toolbox-wails/total?color=67c23a)](https://github.com/tuple97/toolbox-wails/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4)](#下载与安装)
[![License](https://img.shields.io/badge/license-%E5%BE%85%E8%A1%A5%E5%85%85-lightgrey)](#许可)

基于 [Wails v3](https://v3.wails.io) + Go + Vue 3 + TypeScript，单文件免安装（约 20 MB，无需 Go / Node 环境）。

## 功能

| 工具 | 说明 |
| --- | --- |
| **SQL 查询**（多例） | 选模板 + 选连接 → 变量表单（文本 / 下拉 / 多选 / 日期 / 滑块，下拉支持用 SQL 动态取选项）→ 执行 → 结果表格（列宽 / 对齐 / 别名 / 字段映射 / 词典翻译）+ 分页 + 执行日志。结果行右键「复制为…」可生成 INSERT / UPDATE / DELETE，或按自定义导出模板逐行渲染复制 |
| **SQL 执行**（多例） | 直接写 SQL 跑：语句识别与边框、逐条执行按钮、`EXPLAIN` 分析、格式化 / 压缩、结果导出；补全、悬停、重命名、跳转定义都在编辑器里 |
| **SQL 模板**（单例） | `{{变量}}` 占位（Go `text/template` 渲染）、变量配置、字段映射、导出模板、前置 / 后置脚本（goja 执行 + 语法校验）；模板更新即时作用于引用它的查询标签 |
| **连接管理**（单例） | MySQL / PostgreSQL，连接测试、只读连接、环境标记（本地 / 测试 / 生产）、元数据查看；密码加密后本地存储 |
| **词典**（单例） | 维护「原始值 → 可读文本」映射，供字段映射把结果翻译成可读文本 |
| **设置**（单例） | 四套主题、界面 / 编辑器字体与缩放、SQL 补全策略、模板块片段行为、日志条数、快捷键、自动检查更新 |

工作台本身：左侧菜单 + 顶部多标签，标签可拖拽排序 / 重命名 / 锁定 / 批量关闭，重启后完整恢复；菜单与工具面板支持拖动排序与隐藏。

其它细节：

- **智能补全**：库 / 表 / 列 / 函数 / 关键字按子句上下文给候选，支持中文拼音首字母、列多选（勾选若干列一次插入）、表名自动别名；库限定名（`` `db`. ``）能正确解析到目标库。
- **编辑器能力**：语法高亮、错误波浪线（模板脚本校验）、查找替换、列 / 表悬停卡片（类型 / 注释 / 主键 / 索引）、表别名与 CTE 重命名、跳转定义、符号引用高亮、`Ctrl+P` 函数参数提示。
- **执行防护**：只读连接在后端拒绝写操作（含 `SELECT ... INTO OUTFILE`、`FOR UPDATE` 这类「披着 SELECT 的写」）；生产库写操作需显式确认，后端同样校验。

## 下载与安装

到 [Releases](https://github.com/tuple97/toolbox-wails/releases) 下载 `toolbox-windows-amd64.exe`，放到任意目录双击运行即可，不写注册表、不装服务。

- 系统要求：Windows 10 / 11（WebView2 一般随系统自带；缺失时安装 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)）
- 首次运行会在 `%AppData%\Toolbox\` 建库，卸载直接删目录

## 自动更新

应用内置基于 **GitHub Releases** 的更新（Wails v3 自带 updater，含下载校验与可执行文件替换）：

- 默认启动后自动检查一次新版本；发现新版本会询问是否更新，下载完成后可选择立即重启应用生效
- 设置 → 更新：可关闭自动检查、手动「检查更新」、查看当前版本与发版说明，下载中可以取消
- 更新包校验：发布时必须随包上传 `checksums.txt`，下载后核对 SHA-256；**清单缺失或有异常时直接拒绝更新**（不会静默跳过校验）
- 更新状态以后端快照（`UpdateSnapshot`）为唯一来源：设置页只读它，事件只当「状态变了」的通知，前端不自己推断状态
- 同一时刻只允许一个更新流程：正在检查或下载时再点「检查更新」不会打断当前流程
- 开发模式下不启用更新（`dev:app` 会注入 `FRONTEND_DEVSERVER_URL`），避免把已发布的正式版提示成新版本
- 更新能力不依赖数据库：本地库打不开时（界面顶部会提示「初始化失败」）依然可以检查并安装更新
- 版本号显示在状态栏右侧；`toolbox-windows-amd64.exe --version` 可直接打印版本（发布流水线用它校验）

## 快速开始

环境要求：

- Go >= 1.25
- Wails CLI v3：`go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.20`（生成绑定与图标资源用）
- Node >= 20.19 + pnpm 11（`corepack enable pnpm` 或 `npm i -g pnpm`）

```bash
git clone https://github.com/tuple97/toolbox-wails.git
cd toolbox-wails/frontend
pnpm install
```

前端命令都在 `frontend` 目录执行（根目录 `package.json` 只是转发入口）：

| 命令 | 说明 |
| --- | --- |
| `pnpm dev:app` | 启动桌面应用（Vite 开发服务器 + `go run .`，支持热更新） |
| `pnpm dev` | 只启动 Vite 开发服务器（浏览器打开 http://localhost:5173 看界面） |
| `pnpm build` | 类型检查 + 构建前端产物到 `frontend/dist` |
| `pnpm build:app` | 生成图标资源 → 构建前端 → 编译到 `build/bin/toolbox.exe` |
| `pnpm gen:bindings` | 重新生成后端绑定到 `frontend/bindings`（改过 `app/bind_*.go` 后执行） |
| `pnpm typecheck` / `pnpm test` | 类型检查 / 单元测试（vitest） |

> 前端产物通过 `go:embed all:frontend/dist` 嵌进 exe，因此**打包必须先构建前端**（`build:app` 已包含）；开发模式加载 Vite 开发服务器，不受影响。

## 打包与发布

### 本地打包

```bash
cd frontend
pnpm build:app
build\bin\toolbox.exe
```

需要带版本号时先同步清单，再把版本注入二进制：

```powershell
pwsh scripts/set-version.ps1 -Version 0.2.0
cd frontend
pnpm gen:icon
pnpm build
cd ..
go build -tags production -trimpath `
  -ldflags "-w -s -H=windowsgui -X toolbox-wails/app.Version=0.2.0" `
  -o build/bin/toolbox-windows-amd64.exe .
```

可以顺手验一下版本号是否真的注入了（发布流水线也做这一步）：

```powershell
build/bin/toolbox-windows-amd64.exe --version   # 应输出 0.2.0
```

### 发布（CI 自动发版）

在 `main` 上打 tag 即触发 [.github/workflows/release.yml](.github/workflows/release.yml)：

```bash
git tag v0.2.0
git push origin v0.2.0
```

流水线依次：安装依赖 → **后端校验（`gofmt` + `go vet` + `go test`）** → 同步版本号到各清单 → 生成图标资源 → **校验绑定与后端一致（重新生成绑定并比对）** → 前端类型检查 / 单测 / 构建 → 编译 `toolbox-windows-amd64.exe`（注入 tag 版本号）→ 生成 `checksums.txt` 并反向校验 → **用 `--version` 校验 exe 内的版本号等于 tag** → 创建 Release 并上传两个资产。

> 资产名必须是 `toolbox-windows-amd64.exe`：应用内更新按「文件名含平台 + 架构」挑选资产；`checksums.txt` 是下载校验的来源，缺它应用会拒绝更新。校验（格式 / 绑定 / 版本 / 校验和）任何一项不过都不会创建 Release；`workflow_dispatch` 手动触发时只上传构建产物、不发版，方便验证流水线。

## 数据存储

全部数据（连接、模板、词典、标签布局、界面设置）保存在本地 SQLite：

- 数据目录：`%AppData%\Toolbox\`（无法定位时回退到可执行文件同级目录）
- `toolbox.db`：连接、模板、词典、标签、设置
- 同目录存放连接密码的加密密钥文件（系统凭证不可用时的回退位置）

## 密码与安全边界

连接密码用 **AES-256-GCM** 加密后写入 SQLite，主密钥存放在**系统凭证管理器**：

| 平台 | 存放位置 |
| --- | --- |
| Windows | 凭据管理器（Credential Manager） |
| macOS | 钥匙串（Keychain） |
| Linux | Secret Service（gnome-keyring / kwallet 等） |

密钥与数据库文件**分开存放**：只拿到 `toolbox.db` 解不开密码。

**这份加密的实际边界（请不要高估）**：

- 防的是「同机其他用户 / 备份同步目录 / 拷贝走数据库文件」这类场景；
- **不防**能登录本机、以当前用户身份运行程序的攻击者（他一样能取到系统凭证）；
- **不防**内存抓取与调试器；
- 换机器或重装系统后若系统凭证丢失，已存密码需要重新填写。

其它约定：明文密码只在用户点「显示密码」时通过 `RevealPassword` 返回，列表接口不下发。

## 技术栈

- **后端**：Go 1.25 + Wails v3（beta.20，WebView2 渲染）；SQLite（modernc.org/sqlite，纯 Go 无 CGO）；`text/template` 渲染模板；goja 执行前置 / 后置脚本；驱动 go-sql-driver/mysql、lib/pq；密码用 AES-256-GCM + 系统凭证。
- **前端**：Vue 3（SFC，`<script setup>`）+ TypeScript + Vite 7 + pnpm；状态用 Pinia；UI 是项目内自绘组件（Tailwind v4 + reka-ui 无头组件），不依赖 Element Plus 等成品库；编辑器为 CodeMirror 6（SQL / JS / 模板补全、悬停、重命名、跳转均为自研）；另用 vue-draggable-plus（拖拽排序）、sql-formatter、pinyin-pro（拼音补全）。
- **测试**：Go 标准库测试 + vitest（前端单测覆盖补全、光标分析、模板引擎、SQL 生成等纯逻辑）。

## 目录结构

```
toolbox-wails/
├── main.go                     # 入口：服务注册、资源嵌入（go:embed all:frontend/dist）、主窗口、--version
├── wails.json                  # Wails 项目配置（应用名、输出文件名、版本）
├── scripts/set-version.ps1     # 一处改版本号，同步各处清单
├── .github/workflows/          # CI：打 tag 构建并发版（含格式 / 绑定 / 版本 / 校验和四道闸）
├── app/                        # Go 后端
│   ├── app.go                  # App 结构体：依赖装配、生命周期、启动状态（degraded + 重试初始化）
│   ├── update_setup.go         # 更新能力接线（来源配置、HTTP 客户端、签名公钥）
│   ├── bind_*.go               # 绑定层：db / dict / font / settings / tabs / template / update（校验 + 转发）
│   ├── system.go               # 版本号（构建时注入）与应用信息
│   ├── window.go               # 窗口控制
│   └── internal/
│       ├── database/           # SQLite 访问（repository、建表与迁移）
│       ├── services/           # 业务服务（连接 / 模板 / 词典 / 标签 / 设置 / 执行器）
│       ├── update/             # 更新控制器（并发保护、取消、发布策略、状态快照）
│       ├── script/             # goja 前置 / 后置脚本引擎
│       └── utils/              # 模板渲染、加解密等
├── build/                      # 打包资源（icon.ico、manifest、info.json）与产物（build/bin 不入库）
└── frontend/
    ├── bindings/               # wails3 generate bindings 生成（勿手改）
    └── src/
        ├── api/                # 后端接口封装（显式类型映射）
        ├── components/         # 通用组件（标题栏、代码编辑器、结果表格、各配置面板、ui/ 基础组件）
        ├── layouts/            # 工作台布局（左侧菜单 + 多标签）
        ├── stores/             # Pinia（标签 / 配置 / 词典 / 日志 / 元数据 / 更新状态 / 启动状态）
        ├── utils/              # 工具注册表、SQL 补全与模板语言、更新流程等
        ├── views/              # 页面（首页 + views/tools/ 各工具）
        ├── styles/             # 全局样式与主题变量
        └── types/              # 公共类型
```

## 扩展指南

- **新增后端方法**：在 `app/bind_*.go` 加方法（校验 + 转发到 `internal/services`）→ `pnpm gen:bindings` → 前端在 `src/api/*.ts` 封装后使用。
- **新增配置项**：三处同步——Go `defaultSettings`、前端 `configStore.DEFAULTS`、`types` 的 `SettingKey`。
- **新增工具**：`frontend/src/utils/tools.ts` 注册一项 → `Workbench.vue` 加渲染分支 → `views/tools/` 新增视图（初始化结束时 `emit('ready')`，父级据此关闭加载遮罩）。
- **新增更新来源**：`main.go` 里改 `UpdateOptions`，接线细节在 `app/update_setup.go` 的 `SetupUpdate`（框架自带 GitHub、Endpoint、Appcast、Keygen 四种 Provider）；状态契约见 `app/internal/update/snapshot.go`。
- **启用发布签名**：把 Ed25519 公钥填进 `app/internal/update/policy.go` 的 `PublicKey`（当前为 nil，只做 SHA-256 校验），签名发布流程另开一次变更。

## 常见问题

- **启动白屏 / 报 WebView2 缺失**：安装 WebView2 Runtime（Win11 与大部分 Win10 已自带）。
- **链接时报 `gcc` 相关错误**：根目录的 `toolbox-wails.syso` 缺失或为 0 字节，执行 `pnpm gen:icon` 重新生成（务必带 `-arch amd64`）。
- **改了后端方法前端调不到**：忘了 `pnpm gen:bindings`。
- **打包后界面是旧的**：先 `pnpm build` 再编译 Go（`build:app` 已包含这一步）。
- **自动更新检查失败**：多为网络原因（GitHub API 访问受限）；不影响应用使用，也可手动下载新版 exe 覆盖。
- **更新提示「发布包缺少校验和」**：该 Release 没上传 `checksums.txt`（或清单里没有对应文件名）。这是有意的拒绝策略，重新发一次带校验清单的版本即可。
- **界面顶部提示「初始化失败」**：本地库打不开（损坏或权限问题）。点提示里的「重试初始化」，或删除 `%AppData%\Toolbox\` 后重启；更新能力不受影响。

## 许可

仓库目前还没有 `LICENSE` 文件，即默认保留所有权利。要按开源项目正式分发，建议补一个（MIT / Apache-2.0 是最常见的选择），补上后把这里与上方徽章一起改掉即可。
