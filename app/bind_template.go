package app

import (
	"context"
	"fmt"
	"strings"

	"toolbox-wails/app/internal/database"
	"toolbox-wails/app/internal/services"
	"toolbox-wails/app/internal/utils"
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

// ValidateTemplate 校验模板语法，返回错误位置供编辑器标注（红色波浪线）。
//
// 刻意不返回 error、也不依赖数据库连接：纯语法检查，编辑过程中随时可调，
// 校验失败时把位置与消息作为结果返回，界面就不会再弹「模板语法错误」这种
// 定位不了的提示。
func (a *App) ValidateTemplate(sqlText string) utils.TemplateCheck {
	return utils.CheckTemplate(sqlText)
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
// req 中的 Page / PageSize 仅在模板开启分页时生效，未开启时后端会自动忽略。
// Total 与 CountTotal 用于翻页时复用总数：翻页传上次返回的 total 且 CountTotal=false。
func (a *App) ExecuteTemplateQuery(
	ctx context.Context,
	req services.TemplateExecuteRequest,
) (*services.QueryResult, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	if req.TemplateID <= 0 {
		return nil, fmt.Errorf("请先选择 SQL 模板")
	}

	// ctx 由 Wails 注入：前端「取消」时同步中断数据库端的语句
	return a.dbService.ExecuteTemplateQuery(ctx, req)
}
