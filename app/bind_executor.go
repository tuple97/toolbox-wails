package app

import (
	"context"
	"fmt"

	"toolbox-wails/app/internal/services"
)

// ---------------------------------------------------------------- 命令执行器

// ExecuteStatement 执行用户输入的任意 SQL。
//
// ctx 由 Wails 注入：前端对返回的 CancellablePromise 调用 cancel 时，
// 该 ctx 会被取消，数据库端正在执行的语句随之终止。
func (a *App) ExecuteStatement(ctx context.Context, req services.ExecutorRequest) (*services.ExecutorResult, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	if req.ConnID <= 0 {
		return nil, fmt.Errorf("请先选择数据库连接")
	}
	return a.dbService.ExecuteStatement(ctx, req)
}

// ListDatabases 返回连接可见的所有数据库（库选择下拉）。
// 每项带「是否系统库」标记，由适配层按方言判定（前端只负责按设置过滤）。
func (a *App) ListDatabases(ctx context.Context, connID int64) ([]services.DatabaseInfo, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	if connID <= 0 {
		return nil, fmt.Errorf("请先选择数据库连接")
	}
	return a.dbService.ListDatabases(ctx, connID)
}

// ListTables 返回指定库下的表与视图名（智能补全与元数据展示）。
func (a *App) ListTables(ctx context.Context, connID int64, database string) ([]string, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	if connID <= 0 {
		return nil, fmt.Errorf("请先选择数据库连接")
	}
	return a.dbService.ListTables(ctx, connID, database)
}

// ListTableColumns 返回指定表的字段信息（名称 / 类型 / 注释）。
func (a *App) ListTableColumns(ctx context.Context, connID int64, database string, table string) ([]services.ExecutorColumn, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	if connID <= 0 {
		return nil, fmt.Errorf("请先选择数据库连接")
	}
	if table == "" {
		return nil, fmt.Errorf("表名不能为空")
	}
	return a.dbService.ListTableColumns(ctx, connID, database, table)
}

// FetchCreateTableSQL 返回数据库自己的建表语句（拿不到时返回空串，由前端生成）。
func (a *App) FetchCreateTableSQL(ctx context.Context, connID int64, database string, table string) (string, error) {
	if err := a.ready(); err != nil {
		return "", err
	}
	if connID <= 0 {
		return "", fmt.Errorf("请先选择数据库连接")
	}
	return a.dbService.CreateTableSQL(ctx, connID, database, table)
}

// ListForeignKeys 返回指定表的外键约束（智能补全的关联条件用）。
func (a *App) ListForeignKeys(ctx context.Context, connID int64, database string, table string) ([]services.ForeignKey, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	if connID <= 0 {
		return nil, fmt.Errorf("请先选择数据库连接")
	}
	if table == "" {
		return nil, fmt.Errorf("表名不能为空")
	}
	return a.dbService.ListForeignKeys(ctx, connID, database, table)
}
