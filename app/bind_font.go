package app

// ---------------------------------------------------------------- 字体

// ListSystemFonts 返回本机已安装的字体族名称列表。
//
// 供设置面板的字体下拉使用（前端拼成字体栈）。
// 列表在单次运行内缓存，重复调用不会重复读取注册表。
func (a *App) ListSystemFonts() []string {
	return ListSystemFonts()
}
