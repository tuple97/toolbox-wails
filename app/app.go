// Package app 承载应用生命周期，并向前端暴露可绑定的方法。
//
// 分层约定：
//
//	app/                绑定层，仅做参数校验与服务转发
//	app/internal/database  本地 SQLite 与仓储
//	app/internal/services  业务逻辑
//	app/internal/script    goja 脚本引擎（模板渲染与前后置脚本）
//	app/internal/utils     通用工具（加解密等）
package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"toolbox-wails/app/internal/database"
	"toolbox-wails/app/internal/script"
	"toolbox-wails/app/internal/services"
	"toolbox-wails/app/internal/utils"
)

// App 是绑定到前端的根结构体，所有导出方法都会生成前端可调用的绑定。
type App struct {
	ctx context.Context

	// 基础设施
	db     *database.DB
	cipher *utils.Cipher
	engine *script.Engine

	// 业务服务
	tabs      *services.TabService
	templates *services.TemplateService
	dicts     *services.DictService
	dbService *services.DBService
	settings  *services.SettingService
}

// NewApp 创建 App 实例。依赖在 Startup 中惰性初始化，
// 以便失败时能通过事件告知前端，而不是直接 panic。
func NewApp() *App {
	return &App{}
}

// Startup 在应用启动时被调用：初始化数据目录、数据库与各项服务。
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx

	if err := a.init(); err != nil {
		runtime.LogErrorf(ctx, "应用初始化失败: %v", err)
		// 通过事件让前端有机会提示用户，而不是静默失败
		runtime.EventsEmit(ctx, "app:init-error", err.Error())
		return
	}
	runtime.LogInfo(ctx, "应用初始化完成")
}

// Shutdown 在应用退出时被调用，确保最后一次写入落盘。
func (a *App) Shutdown(ctx context.Context) {
	if a.db != nil {
		if err := a.db.Close(); err != nil {
			runtime.LogErrorf(ctx, "关闭数据库失败: %v", err)
		}
	}
	runtime.LogInfo(ctx, "应用已退出")
}

// BeforeClose 在窗口关闭前被调用，通知前端立即保存当前状态。
//
// 前端配合方式：监听 "app:before-quit" 事件并同步调用 SaveTabs。
// 这里只做通知不做阻塞等待——SQLite 写入是本地操作，通常毫秒级完成，
// 而阻塞等待一旦异常会导致窗口无法关闭，体验更差。
func (a *App) BeforeClose(ctx context.Context) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "app:before-quit")
}

// init 完成各项依赖的装配。
func (a *App) init() error {
	dataDir, err := resolveDataDir()
	if err != nil {
		return err
	}

	cipher, err := utils.NewCipher(dataDir)
	if err != nil {
		return fmt.Errorf("初始化加密器失败: %w", err)
	}
	a.cipher = cipher

	db, err := database.Open(dataDir)
	if err != nil {
		return fmt.Errorf("初始化数据库失败: %w", err)
	}
	a.db = db

	repo := database.NewRepository(db)
	engine := script.NewEngine()
	a.engine = engine

	a.tabs = services.NewTabService(repo)
	a.templates = services.NewTemplateService(repo, engine)
	a.dicts = services.NewDictService(repo)
	a.dbService = services.NewDBService(repo, cipher, engine)
	a.settings = services.NewSettingService(repo)

	return nil
}

// resolveDataDir 返回数据目录。
// 优先使用系统用户配置目录，避免将数据写进安装目录（可能无写权限）。
func resolveDataDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		// 退回到可执行文件同级目录
		exe, exeErr := os.Executable()
		if exeErr != nil {
			return "", fmt.Errorf("无法确定数据目录: %w", err)
		}
		base = filepath.Dir(exe)
	}
	return filepath.Join(base, "Toolbox"), nil
}

// Greet 返回一句问候语，用于演示前后端调用链路。
func (a *App) Greet(name string) string {
	if a.ctx != nil {
		runtime.LogInfof(a.ctx, "Greet called with: %s", name)
	}
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

// ready 检查服务是否已初始化，未就绪时返回统一错误。
func (a *App) ready() error {
	if a.dbService == nil || a.tabs == nil || a.settings == nil {
		return fmt.Errorf("应用尚未初始化完成，请稍后重试")
	}
	return nil
}
