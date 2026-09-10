package main

import (
	"context"
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"toolbox-wails/app"
)

//go:embed all:frontend/dist
var assets embed.FS

// 应用窗口相关配置
const (
	appName   = "Toolbox"
	appWidth  = 1024
	appHeight = 700
)

func main() {
	// 创建应用实例
	application := app.NewApp()

	// 启动 Wails 应用
	err := wails.Run(&options.App{
		Title:     appName,
		Width:     appWidth,
		Height:    appHeight,
		MinWidth:  900,
		MinHeight: 600,
		// 无边框窗口：关闭系统标题栏，由前端自定义工具栏接管
		Frameless:     true,
		DisableResize: false,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 17, G: 24, B: 39, A: 1},
		OnStartup:        application.Startup,
		OnShutdown:       application.Shutdown,
		OnBeforeClose: func(ctx context.Context) (prevent bool) {
			// 关窗前通知前端做最后一次同步保存。
			// 前端保存为同步落盘，此处短暂等待即可覆盖绝大多数情况；
			// 即使超时也放行关闭，避免窗口卡住无法退出。
			application.BeforeClose(ctx)
			return false
		},
		Bind: []interface{}{
			application,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
