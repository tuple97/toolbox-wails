package app

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// 模板管理窗口的名称标识。
// 用于 WindowManager.GetByName 做单例判断，避免重复创建。
const templatesWindowName = "templates"

// OpenTemplatesWindow 打开（或聚焦）SQL 模板管理窗口。
//
// v3 多窗口说明：
//   - 每个窗口是独立 webview，拥有独立 JS 上下文（Pinia 状态互不相通），
//     因此模板窗口与主窗口之间通过事件通信（templates:changed）。
//   - 窗口关闭被拦截为「隐藏」（见下方 RegisterHook），webview 与页面上下文
//     保持存活，再次打开时 Show+Focus 即可，无需重新加载页面
//     （重新创建 webview 并加载 Monaco 等资源需要 1~2s）。
//   - 模板窗口为独立 HTML 入口（templates.html，vite 多页应用），
//     dev 模式由 vite 直接提供，生产模式由嵌入的 dist 提供。
func (a *App) OpenTemplatesWindow() {
	if a.wailsApp == nil {
		return
	}

	// 已存在（含被隐藏的窗口）则显示并聚焦
	if win, ok := a.wailsApp.Window.GetByName(templatesWindowName); ok {
		win.Show()
		win.Focus()
		return
	}

	win := a.wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      templatesWindowName,
		Title:     "SQL 模板管理",
		Width:     1100,
		Height:    780,
		MinWidth:  900,
		MinHeight: 600,
		// 无边框 + 前端 TitleBar 组件，与主窗口观感一致
		Frameless: true,
		URL:       "/templates.html",
	})

	// 拦截关闭事件：隐藏窗口而非销毁。
	// 源码依据（beta.20）：HandleWindowEvent 先同步执行 hooks，
	// hook 中 Cancel 后框架默认的销毁 listener（markAsDestroyed + Remove）不会执行。
	win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		e.Cancel()
		win.Hide()
	})
}
