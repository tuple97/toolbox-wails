//go:build !windows

package app

// ListSystemFonts 在非 Windows 平台返回空列表。
//
// 本项目当前只发布 Windows 版本；保留该实现是为了让其他平台也能编译，
// 前端在拿到空列表时只显示内置字体。
func ListSystemFonts() []string {
	return nil
}
