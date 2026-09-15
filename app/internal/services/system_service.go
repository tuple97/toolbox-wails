package services

import (
	"math"
	"os"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/process"
)

// SystemMetrics 描述「应用自身 + 所在机器」的一次实时资源采样。
//
// 前端首页的监控卡片按秒级轮询本结构即可；
// 字段全部为零值表示采样失败（不抛错，避免仪表盘因为一次采样失败而报错）。
type SystemMetrics struct {
	// AppMemoryMB 当前进程内存占用（Windows 为工作集，其它平台为 RSS）
	AppMemoryMB float64 `json:"appMemoryMB"`
	// MemoryTotalMB 物理内存总量
	MemoryTotalMB float64 `json:"memoryTotalMB"`
	// MemoryUsedMB 已用物理内存
	MemoryUsedMB float64 `json:"memoryUsedMB"`
	// MemoryPercent 物理内存使用率（0~100）
	MemoryPercent float64 `json:"memoryPercent"`
	// CPUPercent 全系统 CPU 使用率（0~100）
	CPUPercent float64 `json:"cpuPercent"`
	// CPUCount 逻辑核心数
	CPUCount int `json:"cpuCount"`
	// Timestamp 采样时刻（Unix 毫秒）
	Timestamp int64 `json:"timestamp"`
}

// SystemService 采集系统与应用资源指标。
type SystemService struct{}

// NewSystemService 创建系统指标服务。
func NewSystemService() *SystemService {
	return &SystemService{}
}

// Metrics 采集一次指标。
//
// 各项互相独立：单项失败只让该字段保持为零值，不影响其它字段。
// 注意 CPU 使用率是「区间值」，必需一个采样窗口（这里 200ms），因此本方法会阻塞约 200ms。
func (s *SystemService) Metrics() SystemMetrics {
	metrics := SystemMetrics{
		Timestamp: time.Now().UnixMilli(),
	}

	if vm, err := mem.VirtualMemory(); err == nil && vm != nil {
		metrics.MemoryTotalMB = round1(float64(vm.Total) / 1024 / 1024)
		metrics.MemoryUsedMB = round1(float64(vm.Used) / 1024 / 1024)
		metrics.MemoryPercent = round1(vm.UsedPercent)
	}

	// 进程内存：用 RSS（Windows 上即工作集），比 Go 的 runtime.MemStats 更贴近任务管理器
	if proc, err := process.NewProcess(int32(os.Getpid())); err == nil && proc != nil {
		if info, err := proc.MemoryInfo(); err == nil && info != nil {
			metrics.AppMemoryMB = round1(float64(info.RSS) / 1024 / 1024)
		}
	}

	if percents, err := cpu.Percent(200*time.Millisecond, false); err == nil && len(percents) > 0 {
		metrics.CPUPercent = round1(percents[0])
	}

	if count, err := cpu.Counts(true); err == nil {
		metrics.CPUCount = count
	}

	return metrics
}

// round1 保留一位小数，避免前端展示出现一长串小数。
func round1(value float64) float64 {
	return math.Round(value*10) / 10
}
