package app

import (
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// 本文件集中封装窗口控制能力，供前端自定义工具栏调用。
//
// 说明：无边框（Frameless）窗口下，窗口拖动由 Wails 内置的 CSS 拖动机制接管
// （前端在标题栏上声明 --wails-draggable: drag 即可），无需后端参与；
// 这里只提供工具栏按钮所需的最小化、最大化切换、状态查询与关闭能力。

// WindowMinimise 最小化窗口。
func (a *App) WindowMinimise() {
	if a.ctx == nil {
		return
	}
	runtime.WindowMinimise(a.ctx)
}

// WindowToggleMaximise 在最大化与还原之间切换。
func (a *App) WindowToggleMaximise() {
	if a.ctx == nil {
		return
	}
	runtime.WindowToggleMaximise(a.ctx)
}

// WindowIsMaximised 返回窗口当前是否处于最大化状态。
func (a *App) WindowIsMaximised() bool {
	if a.ctx == nil {
		return false
	}
	return runtime.WindowIsMaximised(a.ctx)
}

// WindowClose 关闭窗口并退出应用。
func (a *App) WindowClose() {
	if a.ctx == nil {
		return
	}
	runtime.Quit(a.ctx)
}
