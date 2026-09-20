// Package app 承载应用生命周期，向前端暴露可绑定的方法
package app

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"

	"toolbox-wails/app/internal/database"
	"toolbox-wails/app/internal/script"
	"toolbox-wails/app/internal/services"
	"toolbox-wails/app/internal/utils"
)

// App 是绑定到前端的根结构体
type App struct {
	wailsApp   *application.App
	mainWindow *application.WebviewWindow

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

// NewApp 创建 App 实例
func NewApp() *App {
	return &App{}
}

// Attach 注入 Wails 应用实例
func (a *App) Attach(wailsApp *application.App) {
	a.wailsApp = wailsApp
}

// AttachWindow 注入主窗口引用
func (a *App) AttachWindow(window *application.WebviewWindow) {
	a.mainWindow = window
}

// ServiceStartup 在应用启动时被调用
func (a *App) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	if err := a.init(); err != nil {
		slog.Error("应用初始化失败", "error", err)
		if a.wailsApp != nil {
			a.wailsApp.Event.Emit("app:init-error", err.Error())
		}
		return nil
	}
	slog.Info("应用初始化完成")
	return nil
}

// ServiceShutdown 在应用退出时被调用
func (a *App) ServiceShutdown() error {
	if a.db != nil {
		if err := a.db.Close(); err != nil {
			slog.Error("关闭数据库失败", "error", err)
		}
	}
	slog.Info("应用已退出")
	return nil
}

// NotifyBeforeQuit 通知前端保存当前状态
func (a *App) NotifyBeforeQuit() {
	if a.wailsApp == nil {
		return
	}
	a.wailsApp.Event.Emit("app:before-quit")
}

// init 完成各项依赖的装配
func (a *App) init() error {
	dataDir, err := resolveDataDir()
	if err != nil {
		return err
	}

	cipher, err := utils.NewCipher(dataDir, resolveKeyDir())
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

// resolveDataDir 返回数据目录
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

// resolveKeyDir 返回主密钥的回退目录
func resolveKeyDir() string {
	if base, err := os.UserCacheDir(); err == nil {
		return filepath.Join(base, "Toolbox")
	}
	return ""
}

// Greet 返回一句问候语
func (a *App) Greet(name string) string {
	slog.Info("Greet 被调用", "name", name)
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

// ready 检查服务是否已初始化
func (a *App) ready() error {
	if a.dbService == nil || a.tabs == nil || a.settings == nil {
		return fmt.Errorf("应用尚未初始化完成，请稍后重试")
	}
	return nil
}
