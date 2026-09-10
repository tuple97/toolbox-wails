package app

import (
	"fmt"
	"strings"

	"toolbox-wails/app/internal/database"
	"toolbox-wails/app/internal/services"
)

// ---------------------------------------------------------------- 数据库连接

// ListConnections 返回全部数据库连接配置。
// 密码字段为密文，前端展示时用掩码，仅在用户主动查看时调用 RevealPassword。
func (a *App) ListConnections() ([]database.DBConnection, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	return a.dbService.ListConnections()
}

// GetConnection 返回单个连接配置。
func (a *App) GetConnection(id int64) (*database.DBConnection, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	return a.dbService.GetConnection(id)
}

// SaveConnection 保存连接配置，密码自动加密。
func (a *App) SaveConnection(conn database.DBConnection) (int64, error) {
	if err := a.ready(); err != nil {
		return 0, err
	}
	if strings.TrimSpace(conn.Name) == "" {
		return 0, fmt.Errorf("连接名称不能为空")
	}
	if strings.TrimSpace(conn.DBType) == "" {
		return 0, fmt.Errorf("请选择数据库类型")
	}
	return a.dbService.SaveConnection(conn)
}

// DeleteConnection 删除连接配置。
func (a *App) DeleteConnection(id int64) error {
	if err := a.ready(); err != nil {
		return err
	}
	return a.dbService.DeleteConnection(id)
}

// TestConnection 测试连接是否可用。
func (a *App) TestConnection(conn database.DBConnection) error {
	if err := a.ready(); err != nil {
		return err
	}
	return a.dbService.TestConnection(conn)
}

// RevealPassword 解密并返回明文密码。
// 仅在用户明确点击「显示密码」时调用，避免明文在任何列表接口中泄露。
func (a *App) RevealPassword(encrypted string) (string, error) {
	if err := a.ready(); err != nil {
		return "", err
	}
	return a.dbService.DecryptPassword(encrypted)
}

// ---------------------------------------------------------------- 查询执行

// ExecuteQuery 执行查询：前置脚本 → 模板渲染 → SQL 执行 → 后置脚本。
func (a *App) ExecuteQuery(req services.ExecuteRequest) (*services.QueryResult, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	if req.ConnID <= 0 {
		return nil, fmt.Errorf("请先选择数据库连接")
	}
	return a.dbService.Execute(req)
}

// QueryVariableOptions 执行 SQL 以获取变量的动态选项。
func (a *App) QueryVariableOptions(connID int64, query string) ([]map[string]any, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(query) == "" {
		return make([]map[string]any, 0), nil
	}
	return a.dbService.QueryOptionsForVariable(connID, query)
}
