package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"

	"toolbox-wails/app"
)

//go:embed all:frontend/dist
var assets embed.FS

// 应用窗口相关配置
const (
	appName   = "Toolbox"
	appWidth  = 1424
	appHeight = 800
)

func main() {
	// 创建业务实例（Wails v3 中作为 Service 绑定到前端）
	service := app.NewApp()

	// 创建 Wails v3 应用
	wailsApp := application.New(application.Options{
		Name:        appName,
		Description: "桌面效率工具箱",
		// v3 使用 Services 替代 v2 的 Bind
		Services: []application.Service{
			application.NewService(service),
		},
		Assets: application.AssetOptions{
			Handler: application.BundledAssetFileServer(assets),
		},
		// 退出前通知前端做最后一次保存。
		// 这里只发事件不阻塞：SQLite 写入是本地操作，通常毫秒级完成；
		// 若在此等待异步保存返回，一旦异常会导致窗口无法关闭。
		ShouldQuit: func() bool {
			service.NotifyBeforeQuit()
			return true
		},
	})

	// 注入应用实例，供窗口控制与事件发送使用
	service.Attach(wailsApp)

	// 创建主窗口
	wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     appName,
		Width:     appWidth,
		Height:    appHeight,
		MinWidth:  1024,
		MinHeight: 700,
		// 无边框窗口：关闭系统标题栏，由前端自定义工具栏接管
		Frameless: true,
		// 与暗色主题 --bg-color(#0f172a) 一致，避免启动首屏黑屏
		// （BackgroundColour 零值为透明，会渲染成黑色）
		BackgroundColour: application.RGBA{Red: 15, Green: 23, Blue: 42, Alpha: 255},
		/*
		 * 背景类型：透明。
		 *
		 * 「背景透明度 / 磨砂」由页面 CSS 控制（#app-backdrop 层负责
		 * rgba 底色 + backdrop-filter），窗口本身必须透明才能透出桌面。
		 * 默认 alpha 为 100（页面底色不透明），观感与不透明窗口一致；
		 * 注意 v3 没有运行时切换 BackgroundType 的 API，只能在创建时确定。
		 */
		BackgroundType: application.BackgroundTypeTransparent,
	})

	if err := wailsApp.Run(); err != nil {
		log.Fatal(err)
	}
}
