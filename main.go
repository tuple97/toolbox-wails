package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"

	"toolbox-wails/app"
)

//go:embed all:frontend/dist
var assets embed.FS

const (
	appName   = "开发工具箱"
	appWidth  = 1424
	appHeight = 800
	// repository 更新来源（GitHub Releases）
	repository = "tuple97/toolbox-wails"
)

func main() {
	// 创建业务实例
	service := app.NewApp()

	// 创建 Wails v3 应用
	wailsApp := application.New(application.Options{
		Name:        appName,
		Description: "桌面效率工具箱",
		Services: []application.Service{
			application.NewService(service),
		},
		Assets: application.AssetOptions{
			Handler: application.BundledAssetFileServer(assets),
		},
		// 退出前通知前端保存
		ShouldQuit: func() bool {
			service.NotifyBeforeQuit()
			return true
		},
	})

	// 注入应用实例
	service.Attach(wailsApp)

	initUpdater(wailsApp)

	// 创建主窗口
	mainWindow := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     appName,
		Width:     appWidth,
		Height:    appHeight,
		MinWidth:  1024,
		MinHeight: 700,
		// 无边框窗口，标题栏由前端接管
		Frameless: true,
		// 与暗色主题背景色一致
		BackgroundColour: application.RGBA{Red: 15, Green: 23, Blue: 42, Alpha: 255},
	})

	// 注入主窗口
	service.AttachWindow(mainWindow)

	if err := wailsApp.Run(); err != nil {
		log.Fatal(err)
	}
}

// initUpdater 配置应用内更新。失败只记日志：没有更新能力不该影响启动。
func initUpdater(wailsApp *application.App) {
	provider, err := github.New(github.Config{
		Repository: repository,
		// 发版时随包发布校验和，下载后核对 SHA-256
		ChecksumAsset: "checksums.txt",
	})
	if err != nil {
		log.Printf("更新来源不可用: %v", err)
		return
	}

	if err := wailsApp.Updater.Init(updater.Config{
		CurrentVersion: app.NormalizedVersion(),
		Providers:      []updater.Provider{provider},
		// 更新界面由设置页承担，不用框架自带窗口
		Window: updater.WindowNone,
	}); err != nil {
		log.Printf("更新功能初始化失败: %v", err)
	}
}
