package app

import (
	"toolbox-wails/app/internal/services"
)

// GetSystemMetrics 返回一次实时系统与应用资源采样（首页监控卡片轮询用）。
//
// 说明：
//   - 不访问数据库，因此不做 a.ready() 校验；
//   - 采样内含 200ms 的 CPU 统计窗口，前端按 1~2 秒轮询即可，不必更密。
func (a *App) GetSystemMetrics() services.SystemMetrics {
	if a.system == nil {
		return services.SystemMetrics{}
	}
	return a.system.Metrics()
}
