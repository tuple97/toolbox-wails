package app

import (
	"toolbox-wails/app/internal/database"
)

// ---------------------------------------------------------------- Tab 工作台

// ListTabs 返回全部工作台 Tab。
func (a *App) ListTabs() ([]database.Tab, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	return a.tabs.List()
}

// SaveTabs 全量保存 Tab 列表，返回写入后带真实 ID 的列表。
//
// 前端在 state 变化后防抖 1s 调用；退出时再同步调用一次兜底。
// 返回回填 ID 的列表是必要的：前端新建标签使用负数占位 ID，
// 保存后需要用数据库分配的 ID 替换，否则下次保存时关联关系会错乱。
func (a *App) SaveTabs(tabs []database.Tab) ([]database.Tab, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	return a.tabs.SaveAll(tabs)
}
