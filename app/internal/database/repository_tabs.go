package database

import (
	"fmt"
)

/*
 * 工作台标签（tabs 表）的读写。
 *
 * 从 repository.go 拆出的原因：各实体的 SQL 形态差异较大
 * （tabs 是全量替换 + ID 回填，templates / dictionaries 是常规 CRUD），
 * 合在一个文件里要按注释分节来回翻找。
 */

// ListTabs 按排序返回全部 Tab。
func (r *Repository) ListTabs() ([]Tab, error) {
	rows, err := r.db.conn.Query(`
		SELECT id, name, sort_order, is_active, is_locked, tool_type, payload, schema_version
		FROM tabs ORDER BY sort_order ASC, id ASC`)
	if err != nil {
		return nil, fmt.Errorf("查询 tabs 失败: %w", err)
	}
	defer rows.Close()

	tabs := make([]Tab, 0)
	for rows.Next() {
		var t Tab
		if scanErr := rows.Scan(
			&t.ID, &t.Name, &t.SortOrder, &t.IsActive, &t.IsLocked,
			&t.ToolType, &t.Payload, &t.SchemaVersion,
		); scanErr != nil {
			return nil, fmt.Errorf("解析 tab 行失败: %w", scanErr)
		}
		tabs = append(tabs, t)
	}
	return tabs, rows.Err()
}

// SaveTabs 以整体覆盖的方式保存 Tab 列表，返回写库后的实际数据。
//
// 采用「事务内全量替换」而非逐条 upsert，可确保排序与删除一并生效，
// 且与前端「一次提交完整状态」的防抖保存模型契合。
//
// 关于 ID（重要）：
// 前端新建标签时会分配负数占位 ID。这里对每一条记录按 ID 区分处理：
//   - ID > 0：视为已存在的记录，**保留原 ID** 写入。
//   - ID <= 0：视为新记录，不写 ID 交由 SQLite 分配，再回填给调用方。
//
// 必须保留已有 ID：若每次保存都重新分配，所有标签的 ID 都会变化，
// 前端据此替换本地数组会导致依赖 tab 身份的组件持续重建与重渲染
// （表现为界面按保存间隔周期性闪烁）。
func (r *Repository) SaveTabs(tabs []Tab) ([]Tab, error) {
	tx, err := r.db.conn.Begin()
	if err != nil {
		return nil, fmt.Errorf("开启事务失败: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec(`DELETE FROM tabs`); err != nil {
		return nil, fmt.Errorf("清空 tabs 失败: %w", err)
	}

	// 已存在记录：显式写入 ID；新记录：由数据库分配
	existingStmt, err := tx.Prepare(`
		INSERT INTO tabs (id, name, sort_order, is_active, is_locked, tool_type, payload, schema_version)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return nil, fmt.Errorf("准备插入语句失败: %w", err)
	}
	defer existingStmt.Close()

	newStmt, err := tx.Prepare(`
		INSERT INTO tabs (name, sort_order, is_active, is_locked, tool_type, payload, schema_version)
		VALUES (?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return nil, fmt.Errorf("准备插入语句失败: %w", err)
	}
	defer newStmt.Close()

	result := make([]Tab, 0, len(tabs))
	for i, t := range tabs {
		version := t.SchemaVersion
		if version <= 0 {
			version = 1
		}

		updated := t
		updated.SortOrder = i

		if t.ID > 0 {
			// 已有记录：保留原 ID
			if _, execErr := existingStmt.Exec(
				t.ID, t.Name, i, boolToInt(t.IsActive), boolToInt(t.IsLocked),
				t.ToolType, t.Payload, version,
			); execErr != nil {
				return nil, fmt.Errorf("写入 tab(%s) 失败: %w", t.Name, execErr)
			}
		} else {
			// 新记录：由数据库分配 ID 并回填
			res, execErr := newStmt.Exec(
				t.Name, i, boolToInt(t.IsActive), boolToInt(t.IsLocked),
				t.ToolType, t.Payload, version,
			)
			if execErr != nil {
				return nil, fmt.Errorf("写入 tab(%s) 失败: %w", t.Name, execErr)
			}

			newID, idErr := res.LastInsertId()
			if idErr != nil {
				return nil, fmt.Errorf("获取 tab(%s) 新 ID 失败: %w", t.Name, idErr)
			}
			updated.ID = newID
		}

		result = append(result, updated)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("提交事务失败: %w", err)
	}
	return result, nil
}

// 分页配置的取值边界。
const (
	defaultPageSize = 50
	maxPageSize     = 1000
)

// normalizePageSize 把页大小约束到合理区间，非法值回落到默认值。
func normalizePageSize(size int) int {
	if size <= 0 {
		return defaultPageSize
	}
	if size > maxPageSize {
		return maxPageSize
	}
	return size
}
