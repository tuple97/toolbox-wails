package database

// Tab 对应 tabs 表，描述一个工作台标签。
// Payload 为各工具私有状态的 JSON 字符串，由前端序列化。
type Tab struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	SortOrder     int    `json:"sortOrder"`
	IsActive      bool   `json:"isActive"`
	IsLocked      bool   `json:"isLocked"`
	ToolType      string `json:"toolType"`
	Payload       string `json:"payload"`
	SchemaVersion int    `json:"schemaVersion"`
}

// DBConnection 对应 db_connections 表，描述一个外部数据库连接。
// Password 在数据库中为密文，对外返回时保持密文，由前端按需解密展示。
type DBConnection struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	DBType   string `json:"dbType"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	Username string `json:"username"`
	Password string `json:"password"`
	Extra    string `json:"extra"`
}

// SQLTemplate 对应 sql_templates 表。
// Variables 与 FieldMappings 均为 JSON 字符串。
type SQLTemplate struct {
	ID            int64  `json:"id"`
	ConnID        int64  `json:"connId"`
	Name          string `json:"name"`
	SQLText       string `json:"sqlText"`
	Variables     string `json:"variables"`
	FieldMappings string `json:"fieldMappings"`
	PreScript     string `json:"preScript"`
	PostScript    string `json:"postScript"`
	// PaginationEnabled 是否对查询结果分页。
	// 开启后执行时会自动统计总数据量，并按 PageSize 切页。
	PaginationEnabled bool `json:"paginationEnabled"`
	// PageSize 每页条数，仅在 PaginationEnabled 为真时生效
	PageSize int `json:"pageSize"`
}

// Dictionary 对应 dictionaries 表。
type Dictionary struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// DictionaryItem 对应 dictionary_items 表。
type DictionaryItem struct {
	ID           int64  `json:"id"`
	DictionaryID int64  `json:"dictionaryId"`
	Value        string `json:"value"`
	Meaning      string `json:"meaning"`
	Description  string `json:"description"`
	SortOrder    int    `json:"sortOrder"`
}

// Setting 对应 app_settings 表。
// Value 以字符串原样存储，由前端按 Type 解析（string/number/boolean/json/array）。
type Setting struct {
	Key   string `json:"key"`
	Type  string `json:"type"`
	Value string `json:"value"`
}
