package app

import (
	"runtime"
)

// Version 为当前应用版本号。
const Version = "0.1.0"

// AppInfo 描述应用及运行环境的基本信息。
type AppInfo struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	GoVersion string `json:"goVersion"`
	Platform  string `json:"platform"`
	Arch      string `json:"arch"`
}

// GetAppInfo 返回当前应用与运行环境信息。
func (a *App) GetAppInfo() AppInfo {
	return AppInfo{
		Name:      "Toolbox",
		Version:   Version,
		GoVersion: runtime.Version(),
		Platform:  runtime.GOOS,
		Arch:      runtime.GOARCH,
	}
}
