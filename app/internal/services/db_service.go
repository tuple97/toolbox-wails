// Package services 承载业务逻辑，向下调用仓储与脚本引擎，向上暴露给绑定层。
package services

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	// 外部数据库驱动
	_ "github.com/go-sql-driver/mysql"
	_ "github.com/lib/pq"

	"toolbox-wails/app/internal/database"
	"toolbox-wails/app/internal/script"
	"toolbox-wails/app/internal/utils"
)

// 查询超时与返回行数上限，防止误操作拖垮应用。
const (
	queryTimeout = 30 * time.Second
	maxRows      = 10000
)

// DBService 负责外部数据库的连接与查询执行。
type DBService struct {
	repo   *database.Repository
	cipher *utils.Cipher
	engine *script.Engine
}

// NewDBService 创建数据库服务。
func NewDBService(repo *database.Repository, cipher *utils.Cipher, engine *script.Engine) *DBService {
	return &DBService{repo: repo, cipher: cipher, engine: engine}
}

// ColumnMeta 描述结果集的一列。
type ColumnMeta struct {
	// Name 列名
	Name string `json:"name"`
	// Type 数据库类型名（驱动提供时填充，否则为空）
	Type string `json:"type"`
}

// QueryResult 描述一次查询的完整结果。
type QueryResult struct {
	// Columns 列元信息（保持数据库返回顺序）
	Columns []ColumnMeta `json:"columns"`
	// Rows 结果集
	Rows []map[string]any `json:"rows"`
	// SQL 实际执行的 SQL，便于用户核对模板渲染结果
	SQL string `json:"sql"`
	// ElapsedMs 执行耗时
	ElapsedMs int64 `json:"elapsedMs"`
	// RowCount 返回行数
	RowCount int `json:"rowCount"`
	// Truncated 是否因超出上限被截断
	Truncated bool `json:"truncated"`
}

// ExecuteRequest 描述一次查询请求。
type ExecuteRequest struct {
	ConnID      int64          `json:"connId"`
	SQLTemplate string         `json:"sqlTemplate"`
	Variables   map[string]any `json:"variables"`
	PreScript   string         `json:"preScript"`
	PostScript  string         `json:"postScript"`
}

// Execute 执行查询的完整链路：
// 前置脚本 → 模板渲染(text/template) → 执行 SQL → 后置脚本。
func (s *DBService) Execute(req ExecuteRequest) (*QueryResult, error) {
	// 1. 前置脚本：允许修改变量并动态生成 SQL 片段
	pre, err := s.engine.RunPreScript(req.PreScript, req.Variables, req.SQLTemplate)
	if err != nil {
		return nil, fmt.Errorf("前置脚本执行失败: %w", err)
	}

	// 2. 渲染模板：text/template（用户无需写点号，预处理会自动补全）
	finalSQL, err := s.renderSQL(req.SQLTemplate, pre.Variables)
	if err != nil {
		return nil, err
	}
	finalSQL += pre.SQLFragment

	if strings.TrimSpace(finalSQL) == "" {
		return nil, fmt.Errorf("渲染后的 SQL 为空，请检查模板与变量配置")
	}

	// 3. 连接并执行
	conn, err := s.repo.GetConnection(req.ConnID)
	if err != nil {
		return nil, err
	}

	db, err := s.openConnection(*conn)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	start := time.Now()
	rows, columns, truncated, err := queryRows(ctx, db, finalSQL)
	if err != nil {
		return nil, err
	}
	elapsed := time.Since(start).Milliseconds()

	// 4. 后置脚本：对结果集做加工
	post, err := s.engine.RunPostScript(req.PostScript, rows)
	if err != nil {
		return nil, fmt.Errorf("后置脚本执行失败: %w", err)
	}

	return &QueryResult{
		Columns:   columns,
		Rows:      post.Rows,
		SQL:       finalSQL,
		ElapsedMs: elapsed,
		RowCount:  len(post.Rows),
		Truncated: truncated,
	}, nil
}

// renderSQL 渲染 SQL 模板。
//
// 关键点：执行前会把模板中检测到的变量补全为空字符串。
// 原因是 text/template 配合 missingkey=error 时，访问不存在的 key 会直接报错，
// 而「变量留空即跳过该条件」（{{if device_no}}）是本工具的核心用法。
// 补全后仍缺失的 key 才是真正的拼写错误，此时报错才有意义。
func (s *DBService) renderSQL(tplText string, variables map[string]any) (string, error) {
	if variables == nil {
		variables = map[string]any{}
	}

	// 补齐模板中引用但调用方未提供的变量
	for _, name := range utils.ExtractTemplateVariables(tplText) {
		if _, exists := variables[name]; !exists {
			variables[name] = ""
		}
	}

	rendered, err := utils.RenderSQL(tplText, variables)
	if err != nil {
		return "", fmt.Errorf("SQL 模板渲染失败: %w", err)
	}
	return rendered, nil
}

// TestConnection 测试连接可用性。
func (s *DBService) TestConnection(conn database.DBConnection) error {
	// 若传入的是已保存连接（仅带 ID），先取出完整配置
	if conn.Host == "" && conn.ID > 0 {
		saved, err := s.repo.GetConnection(conn.ID)
		if err != nil {
			return err
		}
		conn = *saved
	}

	db, err := s.openConnection(conn)
	if err != nil {
		return err
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("连接失败: %w", err)
	}
	return nil
}

// SaveConnection 加密密码后保存连接配置。
func (s *DBService) SaveConnection(conn database.DBConnection) (int64, error) {
	// 前端提交的密码为明文；若以 enc: 开头说明是未修改的原密文，避免重复加密
	if conn.Password != "" && !strings.HasPrefix(conn.Password, "enc:") {
		encrypted, err := s.cipher.Encrypt(conn.Password)
		if err != nil {
			return 0, fmt.Errorf("密码加密失败: %w", err)
		}
		conn.Password = encrypted
	}
	return s.repo.SaveConnection(conn)
}

// GetConnection 返回连接配置，密码保持密文，由前端决定是否解密展示。
func (s *DBService) GetConnection(id int64) (*database.DBConnection, error) {
	return s.repo.GetConnection(id)
}

// ListConnections 返回全部连接配置。
func (s *DBService) ListConnections() ([]database.DBConnection, error) {
	return s.repo.ListConnections()
}

// DeleteConnection 删除连接。
func (s *DBService) DeleteConnection(id int64) error {
	return s.repo.DeleteConnection(id)
}

// DecryptPassword 按需解密密码，仅用于「显示密码」等明确交互。
func (s *DBService) DecryptPassword(encrypted string) (string, error) {
	return s.cipher.Decrypt(encrypted)
}

// QueryOptionsForVariable 执行一条 SQL 以获取下拉框选项。
// 供变量配置中「动态选项来源」使用。
func (s *DBService) QueryOptionsForVariable(connID int64, query string) ([]map[string]any, error) {
	conn, err := s.repo.GetConnection(connID)
	if err != nil {
		return nil, err
	}

	db, err := s.openConnection(*conn)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	rows, _, _, err := queryRows(ctx, db, query)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// ---------------------------------------------------------------- 模板执行

// TemplateExecuteRequest 描述一次「按模板执行」的请求。
type TemplateExecuteRequest struct {
	TemplateID int64          `json:"templateId"`
	ConnID     int64          `json:"connId"`
	Variables  map[string]any `json:"variables"`
}

// ExecuteTemplateQuery 按模板执行查询。
//
// 与 Execute 的区别：SQL、脚本等均从模板表读取，前端只传模板 ID 与变量值。
// 这样模板更新后，引用它的 Tab 无需同步即可在下次执行时生效。
func (s *DBService) ExecuteTemplateQuery(req TemplateExecuteRequest) (*QueryResult, error) {
	tpl, err := s.repo.GetTemplate(req.TemplateID)
	if err != nil {
		return nil, err
	}

	// 连接优先使用入参，未指定时回退到模板上配置的连接
	connID := req.ConnID
	if connID <= 0 {
		connID = tpl.ConnID
	}
	if connID <= 0 {
		return nil, fmt.Errorf("模板未关联数据库连接，请先选择连接")
	}

	return s.Execute(ExecuteRequest{
		ConnID:      connID,
		SQLTemplate: tpl.SQLText,
		Variables:   req.Variables,
		PreScript:   tpl.PreScript,
		PostScript:  tpl.PostScript,
	})
}

// ---------------------------------------------------------------- 内部实现

// openConnection 按数据库类型构造 DSN 并建立连接。
func (s *DBService) openConnection(conn database.DBConnection) (*sql.DB, error) {
	password, err := s.cipher.Decrypt(conn.Password)
	if err != nil {
		return nil, fmt.Errorf("解密数据库密码失败: %w", err)
	}

	driver, dsn, err := buildDSN(conn, password)
	if err != nil {
		return nil, err
	}

	db, err := sql.Open(driver, dsn)
	if err != nil {
		return nil, fmt.Errorf("打开数据库失败: %w", err)
	}

	// 连接池参数：避免长期占用过多外部连接
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(10 * time.Minute)

	return db, nil
}

// buildDSN 根据数据库类型生成驱动名与连接串。
func buildDSN(conn database.DBConnection, password string) (string, string, error) {
	port := conn.Port

	switch strings.ToLower(conn.DBType) {
	case "mysql":
		if port == 0 {
			port = 3306
		}
		// parseTime 让时间类型正确映射；charset 保证中文不出乱码
		dsn := fmt.Sprintf(
			"%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&parseTime=true&loc=Local&timeout=10s",
			conn.Username, password, conn.Host, port, conn.Database,
		)
		return "mysql", dsn, nil

	case "postgres", "postgresql":
		if port == 0 {
			port = 5432
		}
		// 使用 URL 形式并对账号密码做转义，避免特殊字符破坏连接串
		dsn := fmt.Sprintf(
			"postgres://%s:%s@%s:%d/%s?sslmode=disable",
			url.QueryEscape(conn.Username),
			url.QueryEscape(password),
			conn.Host, port, conn.Database,
		)
		return "postgres", dsn, nil

	default:
		return "", "", fmt.Errorf("暂不支持的数据库类型: %s", conn.DBType)
	}
}

// queryRows 执行查询并返回列元信息与结果集。
func queryRows(ctx context.Context, db *sql.DB, query string) ([]map[string]any, []ColumnMeta, bool, error) {
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, nil, false, fmt.Errorf("执行 SQL 失败: %w", err)
	}
	defer rows.Close()

	rawColumns, err := rows.Columns()
	if err != nil {
		return nil, nil, false, fmt.Errorf("读取列信息失败: %w", err)
	}

	// 尝试读取数据库类型信息；部分驱动不支持时降级为空类型
	columnTypes, _ := rows.ColumnTypes()
	columns := make([]ColumnMeta, len(rawColumns))
	for i, name := range rawColumns {
		columns[i] = ColumnMeta{Name: name}
		if columnTypes != nil && i < len(columnTypes) && columnTypes[i] != nil {
			columns[i].Type = columnTypes[i].DatabaseTypeName()
		}
	}

	result := make([]map[string]any, 0)
	truncated := false

	for rows.Next() {
		if len(result) >= maxRows {
			truncated = true
			break
		}

		// 用 RawBytes 承接任意类型，再按列转换
		values := make([]any, len(rawColumns))
		pointers := make([]any, len(rawColumns))
		for i := range values {
			pointers[i] = &values[i]
		}

		if err := rows.Scan(pointers...); err != nil {
			return nil, nil, false, fmt.Errorf("读取结果行失败: %w", err)
		}

		item := make(map[string]any, len(rawColumns))
		for i, col := range rawColumns {
			item[col] = normalizeValue(values[i])
		}
		result = append(result, item)
	}

	if err := rows.Err(); err != nil {
		return nil, nil, false, fmt.Errorf("遍历结果集失败: %w", err)
	}
	return result, columns, truncated, nil
}

// normalizeValue 把驱动返回的原始值转为 JSON 友好的类型。
// 数据库驱动常返回 []byte，直接序列化会变成 Base64，这里统一转字符串。
func normalizeValue(value any) any {
	switch v := value.(type) {
	case nil:
		return nil
	case []byte:
		// 尝试识别为数字，保持前端排序与比较正确
		text := string(v)
		if num, err := strconv.ParseFloat(text, 64); err == nil {
			return num
		}
		return text
	case time.Time:
		return v.Format("2006-01-02 15:04:05")
	default:
		return v
	}
}
