package database

import (
	"database/sql"
	"fmt"
)

// Repository 聚合各表的 CRUD 操作，统一持有本地连接。
type Repository struct {
	db *DB
}

// NewRepository 创建仓储实例。
func NewRepository(db *DB) *Repository {
	return &Repository{db: db}
}

// ---------------------------------------------------------------- Tab

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

// ---------------------------------------------------------------- DBConnection

// ListConnections 返回全部数据库连接。
func (r *Repository) ListConnections() ([]DBConnection, error) {
	rows, err := r.db.conn.Query(`
		SELECT id, name, db_type, host, port, database, username, password, extra
		FROM db_connections ORDER BY id ASC`)
	if err != nil {
		return nil, fmt.Errorf("查询 db_connections 失败: %w", err)
	}
	defer rows.Close()

	list := make([]DBConnection, 0)
	for rows.Next() {
		item, scanErr := scanConnection(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

// GetConnection 按 ID 返回单个连接。
func (r *Repository) GetConnection(id int64) (*DBConnection, error) {
	row := r.db.conn.QueryRow(`
		SELECT id, name, db_type, host, port, database, username, password, extra
		FROM db_connections WHERE id = ?`, id)

	item, err := scanConnection(row)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("连接不存在: %d", id)
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

// SaveConnection 新增或更新连接，返回记录 ID。
func (r *Repository) SaveConnection(c DBConnection) (int64, error) {
	if c.ID > 0 {
		_, err := r.db.conn.Exec(`
			UPDATE db_connections
			SET name = ?, db_type = ?, host = ?, port = ?, database = ?, username = ?, password = ?, extra = ?
			WHERE id = ?`,
			c.Name, c.DBType, c.Host, c.Port, c.Database, c.Username, c.Password, c.Extra, c.ID)
		if err != nil {
			return 0, fmt.Errorf("更新连接失败: %w", err)
		}
		return c.ID, nil
	}

	res, err := r.db.conn.Exec(`
		INSERT INTO db_connections (name, db_type, host, port, database, username, password, extra)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		c.Name, c.DBType, c.Host, c.Port, c.Database, c.Username, c.Password, c.Extra)
	if err != nil {
		return 0, fmt.Errorf("新增连接失败: %w", err)
	}
	return res.LastInsertId()
}

// DeleteConnection 删除连接。
func (r *Repository) DeleteConnection(id int64) error {
	if _, err := r.db.conn.Exec(`DELETE FROM db_connections WHERE id = ?`, id); err != nil {
		return fmt.Errorf("删除连接失败: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------- SQLTemplate

// ListTemplates 返回全部 SQL 模板。
func (r *Repository) ListTemplates() ([]SQLTemplate, error) {
	rows, err := r.db.conn.Query(`
		SELECT id, conn_id, name, sql_text, variables, field_mappings,
		       COALESCE(pre_script, ''), COALESCE(post_script, '')
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
		       COALESCE(pre_script, ''), COALESCE(post_script, '')
		FROM sql_templates WHERE id = ?`, id)

	var t SQLTemplate
	err := row.Scan(
		&t.ID, &t.ConnID, &t.Name, &t.SQLText, &t.Variables,
		&t.FieldMappings, &t.PreScript, &t.PostScript,
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
			SET conn_id = ?, name = ?, sql_text = ?, variables = ?, field_mappings = ?, pre_script = ?, post_script = ?
			WHERE id = ?`,
			t.ConnID, t.Name, t.SQLText, t.Variables, t.FieldMappings, t.PreScript, t.PostScript, t.ID)
		if err != nil {
			return 0, fmt.Errorf("更新模板失败: %w", err)
		}
		return t.ID, nil
	}

	res, err := r.db.conn.Exec(`
		INSERT INTO sql_templates (conn_id, name, sql_text, variables, field_mappings, pre_script, post_script)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		t.ConnID, t.Name, t.SQLText, t.Variables, t.FieldMappings, t.PreScript, t.PostScript)
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

// ---------------------------------------------------------------- Dictionary

// ListDictionaries 返回全部词典。
func (r *Repository) ListDictionaries() ([]Dictionary, error) {
	rows, err := r.db.conn.Query(`
		SELECT id, name, COALESCE(description, '') FROM dictionaries ORDER BY id ASC`)
	if err != nil {
		return nil, fmt.Errorf("查询 dictionaries 失败: %w", err)
	}
	defer rows.Close()

	list := make([]Dictionary, 0)
	for rows.Next() {
		var d Dictionary
		if scanErr := rows.Scan(&d.ID, &d.Name, &d.Description); scanErr != nil {
			return nil, fmt.Errorf("解析词典行失败: %w", scanErr)
		}
		list = append(list, d)
	}
	return list, rows.Err()
}

// SaveDictionary 新增或更新词典，返回记录 ID。
func (r *Repository) SaveDictionary(d Dictionary) (int64, error) {
	if d.ID > 0 {
		_, err := r.db.conn.Exec(
			`UPDATE dictionaries SET name = ?, description = ? WHERE id = ?`,
			d.Name, d.Description, d.ID)
		if err != nil {
			return 0, fmt.Errorf("更新词典失败: %w", err)
		}
		return d.ID, nil
	}

	res, err := r.db.conn.Exec(
		`INSERT INTO dictionaries (name, description) VALUES (?, ?)`,
		d.Name, d.Description)
	if err != nil {
		return 0, fmt.Errorf("新增词典失败: %w", err)
	}
	return res.LastInsertId()
}

// DeleteDictionary 删除词典，其下词典项随外键级联删除。
func (r *Repository) DeleteDictionary(id int64) error {
	if _, err := r.db.conn.Exec(`DELETE FROM dictionaries WHERE id = ?`, id); err != nil {
		return fmt.Errorf("删除词典失败: %w", err)
	}
	return nil
}

// ListDictionaryItems 返回指定词典的全部项。
func (r *Repository) ListDictionaryItems(dictionaryID int64) ([]DictionaryItem, error) {
	rows, err := r.db.conn.Query(`
		SELECT id, dictionary_id, value, meaning, COALESCE(description, ''), sort_order
		FROM dictionary_items WHERE dictionary_id = ? ORDER BY sort_order ASC, id ASC`, dictionaryID)
	if err != nil {
		return nil, fmt.Errorf("查询 dictionary_items 失败: %w", err)
	}
	defer rows.Close()

	list := make([]DictionaryItem, 0)
	for rows.Next() {
		var item DictionaryItem
		if scanErr := rows.Scan(
			&item.ID, &item.DictionaryID, &item.Value, &item.Meaning,
			&item.Description, &item.SortOrder,
		); scanErr != nil {
			return nil, fmt.Errorf("解析词典项失败: %w", scanErr)
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

// SaveDictionaryItems 以整体覆盖方式保存某词典下的全部项。
func (r *Repository) SaveDictionaryItems(dictionaryID int64, items []DictionaryItem) error {
	tx, err := r.db.conn.Begin()
	if err != nil {
		return fmt.Errorf("开启事务失败: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec(`DELETE FROM dictionary_items WHERE dictionary_id = ?`, dictionaryID); err != nil {
		return fmt.Errorf("清空词典项失败: %w", err)
	}

	stmt, err := tx.Prepare(`
		INSERT INTO dictionary_items (dictionary_id, value, meaning, description, sort_order)
		VALUES (?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("准备插入语句失败: %w", err)
	}
	defer stmt.Close()

	for i, item := range items {
		if _, err := stmt.Exec(dictionaryID, item.Value, item.Meaning, item.Description, i); err != nil {
			return fmt.Errorf("写入词典项(%s) 失败: %w", item.Value, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("提交事务失败: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------- 内部工具

// rowScanner 抽象 *sql.Row 与 *sql.Rows 的公共 Scan 行为。
type rowScanner interface {
	Scan(dest ...any) error
}

// scanConnection 从一行结果解析连接信息。
func scanConnection(s rowScanner) (DBConnection, error) {
	var c DBConnection
	// host/database/username/password/extra 允许为 NULL，用 NullString 承接
	var host, database, username, password, extra sql.NullString
	var port sql.NullInt64

	if err := s.Scan(
		&c.ID, &c.Name, &c.DBType, &host, &port,
		&database, &username, &password, &extra,
	); err != nil {
		if err == sql.ErrNoRows {
			return c, err
		}
		return c, fmt.Errorf("解析连接行失败: %w", err)
	}

	c.Host = host.String
	c.Port = int(port.Int64)
	c.Database = database.String
	c.Username = username.String
	c.Password = password.String
	c.Extra = extra.String
	return c, nil
}

// boolToInt 将布尔值转为 SQLite 的 0/1。
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
