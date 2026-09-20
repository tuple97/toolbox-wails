package app

import (
	"context"
	"fmt"
	"time"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

// checkTimeout 版本检查超时：网络不通时不该让界面一直转
const checkTimeout = 15 * time.Second

// UpdateInfo 一次版本检查的结果。
type UpdateInfo struct {
	// Current 当前版本
	Current string `json:"current"`
	// Latest 最新版本；没有新版本时与 Current 相同
	Latest string `json:"latest"`
	// Available 是否有新版本可装
	Available bool `json:"available"`
	// Notes 发版说明（GitHub Release 正文）
	Notes string `json:"notes"`
	// PublishedAt 发布时间（RFC3339，未知时为空）
	PublishedAt string `json:"publishedAt"`
	// AssetName 更新包文件名
	AssetName string `json:"assetName"`
	// AssetSize 更新包字节数
	AssetSize int64 `json:"assetSize"`
}

// CheckUpdate 检查是否有新版本；没有更新时 Available 为 false。
func (a *App) CheckUpdate() (UpdateInfo, error) {
	info := UpdateInfo{Current: Version, Latest: Version}
	client, err := a.updater()
	if err != nil {
		return info, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), checkTimeout)
	defer cancel()

	release, err := client.Check(ctx)
	if err != nil {
		return info, fmt.Errorf("检查更新失败: %w", err)
	}
	if release == nil {
		return info, nil
	}

	info.Available = true
	info.Latest = release.Version
	info.Notes = release.Notes
	info.AssetName = release.Artifact.Filename
	info.AssetSize = release.Artifact.Size
	if !release.PublishedAt.IsZero() {
		info.PublishedAt = release.PublishedAt.Format(time.RFC3339)
	}
	return info, nil
}

// DownloadUpdate 下载并安装更新；进度与阶段通过 wails:updater:* 事件上报。
func (a *App) DownloadUpdate() error {
	client, err := a.updater()
	if err != nil {
		return err
	}
	if err := client.DownloadAndInstall(context.Background()); err != nil {
		return fmt.Errorf("下载更新失败: %w", err)
	}
	return nil
}

// RestartToApplyUpdate 重启应用以应用已安装的更新。
func (a *App) RestartToApplyUpdate() error {
	client, err := a.updater()
	if err != nil {
		return err
	}
	return client.Restart(context.Background())
}

// UpdateState 当前更新状态：unconfigured / idle / checking / available /
// downloading / verifying / installing / ready / error。
func (a *App) UpdateState() string {
	if a.wailsApp == nil {
		return string(updater.StateUnconfigured)
	}
	return string(a.wailsApp.Updater.State())
}

// updater 取已初始化的更新器；未初始化时给出可读的提示
func (a *App) updater() (*updater.Updater, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	if a.wailsApp == nil || a.wailsApp.Updater == nil {
		return nil, fmt.Errorf("更新功能不可用")
	}
	return a.wailsApp.Updater, nil
}
