package database

import (
	"database/sql"
	"fmt"
)

// SQL 模板（sql_templates 表）的读写。

// ListTemplates 返回全部 SQL 模板。
func (r *Repository) ListTemplates() ([]SQLTemplate, error) {
	rows, err := r.db.conn.Query(`
		SELECT id, conn_id, name, sql_text, variables, field_mappings,
		       COALESCE(pre_script, ''), COALESCE(post_script, ''),
		       COALESCE(page_size, 50)
		FROM sql_templates ORDER BY id ASC`)
	if err != nil {
		return nil, fmt.Errorf("查询 sql_templates 失败: %w", err)
	}
	defer rows.Close()

	list := make([]SQLTemplate, 0)
	for rows.Next() {
		var t SQLTemplate
		if scanErr := rows.Scan(
			&t.ID, &t.ConnID, &t.Name, &t.SQLText, &t.Variables,
			&t.FieldMappings, &t.PreScript, &t.PostScript,
			&t.PageSize,
		); scanErr != nil {
			return nil, fmt.Errorf("解析模板行失败: %w", scanErr)
		}
		list = append(list, t)
	}
	return list, rows.Err()
}

// GetTemplate 按 ID 返回单个 SQL 模板。
func (r *Repository) GetTemplate(id int64) (*SQLTemplate, error) {
	row := r.db.conn.QueryRow(`
		SELECT id, conn_id, name, sql_text, variables, field_mappings,
		       COALESCE(pre_script, ''), COALESCE(post_script, ''),
		       COALESCE(page_size, 50)
		FROM sql_templates WHERE id = ?`, id)

	var t SQLTemplate
	err := row.Scan(
		&t.ID, &t.ConnID, &t.Name, &t.SQLText, &t.Variables,
		&t.FieldMappings, &t.PreScript, &t.PostScript,
		&t.PageSize,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("模板不存在: %d", id)
	}
	if err != nil {
		return nil, fmt.Errorf("查询模板失败: %w", err)
	}
	return &t, nil
}

// SaveTemplate 新增或更新 SQL 模板，返回记录 ID。
func (r *Repository) SaveTemplate(t SQLTemplate) (int64, error) {
	if t.ID > 0 {
		_, err := r.db.conn.Exec(`
			UPDATE sql_templates
			SET conn_id = ?, name = ?, sql_text = ?, variables = ?, field_mappings = ?, pre_script = ?, post_script = ?,
			    page_size = ?
			WHERE id = ?`,
			t.ConnID, t.Name, t.SQLText, t.Variables, t.FieldMappings, t.PreScript, t.PostScript,
			normalizePageSize(t.PageSize), t.ID)
		if err != nil {
			return 0, fmt.Errorf("更新模板失败: %w", err)
		}
		return t.ID, nil
	}

	res, err := r.db.conn.Exec(`
		INSERT INTO sql_templates (conn_id, name, sql_text, variables, field_mappings, pre_script, post_script,
		                           page_size)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ConnID, t.Name, t.SQLText, t.Variables, t.FieldMappings, t.PreScript, t.PostScript,
		normalizePageSize(t.PageSize))
	if err != nil {
		return 0, fmt.Errorf("新增模板失败: %w", err)
	}
	return res.LastInsertId()
}

// DeleteTemplate 删除模板。
func (r *Repository) DeleteTemplate(id int64) error {
	if _, err := r.db.conn.Exec(`DELETE FROM sql_templates WHERE id = ?`, id); err != nil {
		return fmt.Errorf("删除模板失败: %w", err)
	}
	return nil
}
