package services

import (
	"fmt"

	"toolbox-wails/app/internal/database"
	"toolbox-wails/app/internal/script"
	"toolbox-wails/app/internal/utils"
)

// TemplateService 负责 SQL 模板的持久化与变量解析。
type TemplateService struct {
	repo   *database.Repository
	engine *script.Engine
}

// NewTemplateService 创建模板服务。
func NewTemplateService(repo *database.Repository, engine *script.Engine) *TemplateService {
	return &TemplateService{repo: repo, engine: engine}
}

// List 返回全部 SQL 模板。
func (s *TemplateService) List() ([]database.SQLTemplate, error) {
	return s.repo.ListTemplates()
}

// ListWithPreview 返回模板列表，附带截断后的 SQL 预览。
// 列表场景不需要完整 SQL，截断可减少 IPC 传输量。
func (s *TemplateService) ListWithPreview(limit int) ([]TemplateListItem, error) {
	if limit <= 0 {
		limit = 100
	}

	list, err := s.repo.ListTemplates()
	if err != nil {
		return nil, err
	}

	items := make([]TemplateListItem, 0, len(list))
	for _, tpl := range list {
		items = append(items, TemplateListItem{
			ID:      tpl.ID,
			Name:    tpl.Name,
			ConnID:  tpl.ConnID,
			SQLText: truncate(tpl.SQLText, limit),
		})
	}
	return items, nil
}

// TemplateListItem 是模板列表项（含 SQL 预览）。
type TemplateListItem struct {
	ID      int64  `json:"id"`
	Name    string `json:"name"`
	ConnID  int64  `json:"connId"`
	SQLText string `json:"sqlText"`
}

// Get 按 ID 返回完整模板。
func (s *TemplateService) Get(id int64) (*database.SQLTemplate, error) {
	return s.repo.GetTemplate(id)
}

// Save 新增或更新模板。
func (s *TemplateService) Save(tpl database.SQLTemplate) (int64, error) {
	// 保存前校验模板语法，避免把错误模板写入库中
	if err := utils.ValidateTemplate(tpl.SQLText); err != nil {
		return 0, err
	}
	return s.repo.SaveTemplate(tpl)
}

// Delete 删除模板。
func (s *TemplateService) Delete(id int64) error {
	return s.repo.DeleteTemplate(id)
}

// ExtractVariables 解析模板中出现的变量名。
//
// 实现基于 text/template 的预处理与字段引用提取，
// 支持 {{if device_no}}、{{range list}}、{{quote name}} 等写法。
func (s *TemplateService) ExtractVariables(sqlText string) ([]string, error) {
	if err := utils.ValidateTemplate(sqlText); err != nil {
		return nil, err
	}
	names := utils.ExtractTemplateVariables(sqlText)
	if names == nil {
		names = make([]string, 0)
	}
	return names, nil
}

// ValidateScript 校验脚本语法，供前端保存前预检。
func (s *TemplateService) ValidateScript(source string) error {
	return s.engine.ValidateScript(source)
}

// Preview 预览模板渲染结果，便于用户在编辑时即时看到最终 SQL。
func (s *TemplateService) Preview(sqlText string, variables map[string]any) (string, error) {
	if err := utils.ValidateTemplate(sqlText); err != nil {
		return "", err
	}

	// 与执行时保持一致：补齐缺失变量为空值，使 {{if x}} 能正常走 else 分支
	if variables == nil {
		variables = map[string]any{}
	}
	for _, name := range utils.ExtractTemplateVariables(sqlText) {
		if _, exists := variables[name]; !exists {
			variables[name] = ""
		}
	}

	rendered, err := utils.RenderSQL(sqlText, variables)
	if err != nil {
		return "", fmt.Errorf("模板渲染失败: %w", err)
	}
	return rendered, nil
}

// truncate 按字符数截断字符串，超出部分以省略号标记。
func truncate(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit]) + "..."
}
