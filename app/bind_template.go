package app

import (
	"fmt"
	"strings"

	"toolbox-wails/app/internal/database"
	"toolbox-wails/app/internal/services"
)

// ---------------------------------------------------------------- SQL 模板

// ListSqlTemplates 返回模板列表（含截断的 SQL 预览）。
// 列表场景无需完整 SQL，截断可显著减少 IPC 传输量。
func (a *App) ListSqlTemplates() ([]services.TemplateListItem, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	return a.templates.ListWithPreview(100)
}

// ListTemplates 返回全部模板（含完整字段）。
// 保留该方法以兼容已有调用。
func (a *App) ListTemplates() ([]database.SQLTemplate, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	return a.templates.List()
}

// GetSqlTemplate 按 ID 返回完整模板。
func (a *App) GetSqlTemplate(id int64) (*database.SQLTemplate, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	if id <= 0 {
		return nil, fmt.Errorf("模板 ID 非法")
	}
	return a.templates.Get(id)
}

// SaveSqlTemplate 新增或更新模板。id 为 0 时插入，否则更新。
func (a *App) SaveSqlTemplate(tpl database.SQLTemplate) (int64, error) {
	if err := a.ready(); err != nil {
		return 0, err
	}
	if strings.TrimSpace(tpl.Name) == "" {
		return 0, fmt.Errorf("模板名称不能为空")
	}
	if tpl.ConnID <= 0 {
		return 0, fmt.Errorf("请先选择数据库连接")
	}
	return a.templates.Save(tpl)
}

// SaveTemplate 兼容旧接口，等价于 SaveSqlTemplate。
func (a *App) SaveTemplate(tpl database.SQLTemplate) (int64, error) {
	return a.SaveSqlTemplate(tpl)
}

// DeleteSqlTemplate 删除模板。
func (a *App) DeleteSqlTemplate(id int64) error {
	if err := a.ready(); err != nil {
		return err
	}
	return a.templates.Delete(id)
}

// DeleteTemplate 兼容旧接口。
func (a *App) DeleteTemplate(id int64) error {
	return a.DeleteSqlTemplate(id)
}

// ExtractTemplateVariables 解析 SQL 模板中的变量名。
func (a *App) ExtractTemplateVariables(sqlText string) ([]string, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	return a.templates.ExtractVariables(sqlText)
}

// PreviewTemplate 渲染模板，返回最终 SQL。
func (a *App) PreviewTemplate(sqlText string, variables map[string]any) (string, error) {
	if err := a.ready(); err != nil {
		return "", err
	}
	return a.templates.Preview(sqlText, variables)
}

// ValidateScript 校验前置/后置脚本语法。
func (a *App) ValidateScript(source string) error {
	if err := a.ready(); err != nil {
		return err
	}
	if err := a.templates.ValidateScript(source); err != nil {
		return fmt.Errorf("脚本语法错误: %w", err)
	}
	return nil
}

// ExecuteTemplateQuery 按模板执行查询。
//
// 完整链路：取模板 → 补全变量 → 前置脚本 → 渲染 SQL → 执行 → 后置脚本。
// 模板更新后，引用它的 Tab 无需同步即可在下次执行时生效。
//
// page / pageSize 仅在模板开启分页时生效，未开启时后端会自动忽略。
func (a *App) ExecuteTemplateQuery(
	templateId int64,
	connId int64,
	variables map[string]any,
	page int,
	pageSize int,
) (*services.QueryResult, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	if templateId <= 0 {
		return nil, fmt.Errorf("请先选择 SQL 模板")
	}

	return a.dbService.ExecuteTemplateQuery(services.TemplateExecuteRequest{
		TemplateID: templateId,
		ConnID:     connId,
		Variables:  variables,
		Page:       page,
		PageSize:   pageSize,
	})
}
