package database

/*
 * Repository：本地 SQLite 各表 CRUD 的聚合入口。
 *
 * 按实体拆分到同包的多个文件（避免单文件过长、按表定位更容易）：
 *   - repository_tabs.go        工作台标签（含分页边界常量）
 *   - repository_connections.go 数据库连接（含行扫描与列清单）
 *   - repository_templates.go   SQL 模板
 *   - repository_dicts.go       词典与词典项
 * 本文件只保留聚合结构与各实体共用的小工具。
 */

// Repository 聚合各表的 CRUD 操作，统一持有本地连接。
type Repository struct {
	db *DB
}

// NewRepository 创建仓储实例。
func NewRepository(db *DB) *Repository {
	return &Repository{db: db}
}

// boolToInt 将布尔值转为 SQLite 的 0/1。
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
