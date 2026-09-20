package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"

	"toolbox-wails/app"
)

//go:embed all:frontend/dist
var assets embed.FS

const (
	appName   = "开发工具箱"
	appWidth  = 1424
	appHeight = 800
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
