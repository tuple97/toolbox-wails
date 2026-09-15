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
//
// 字段按本项目只支持的 mysql/postgres 两种方言裁剪，分为以下几组：
//   - 基本：Name / DBType / Host / Port / Database / Username / Password；
//   - 展示：Note（备注）、Color（颜色标记）、IsProduction（生产库标记，界面提示用）；
//   - 方言：Charset（MySQL 字符集）、DefaultSchema（PostgreSQL 默认 schema）；
//   - 超时：ConnectTimeoutSecs / QueryTimeoutSecs / KeepaliveSecs（0 表示用默认值）；
//   - 加密：SSLMode + 三个证书路径（MySQL 映射到 tls，PostgreSQL 映射到 sslmode 等）；
//   - 其它：URLParams（追加到连接串的自定义参数）、ReadOnly（拒绝写操作）、Extra（预留 JSON）。
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

	// Note 备注（连接列表悬停展示）
	Note string `json:"note"`
	// Color 颜色标记（列表与标签着色，空表示不标记）
	Color string `json:"color"`
	// Charset MySQL 字符集，空表示 utf8mb4
	Charset string `json:"charset"`
	// DefaultSchema PostgreSQL 默认 schema（MySQL 留空，库由 Database 决定）
	DefaultSchema string `json:"defaultSchema"`
	// ConnectTimeoutSecs 建立连接超时（秒），0 表示默认 10
	ConnectTimeoutSecs int `json:"connectTimeoutSecs"`
	// QueryTimeoutSecs 单条语句超时（秒），0 表示默认 60
	QueryTimeoutSecs int `json:"queryTimeoutSecs"`
	// KeepaliveSecs 空闲连接回收时间（秒），0 表示默认 30
	KeepaliveSecs int `json:"keepaliveSecs"`
	// SSLMode SSL 模式：disable / prefer / require / verify-ca / verify-full，空表示 disable
	SSLMode string `json:"sslMode"`
	// SSLCaPath CA 证书路径（verify-ca / verify-full 时必填）
	SSLCaPath string `json:"sslCaPath"`
	// SSLCertPath 客户端证书路径（双向认证时填）
	SSLCertPath string `json:"sslCertPath"`
	// SSLKeyPath 客户端私钥路径（双向认证时填）
	SSLKeyPath string `json:"sslKeyPath"`
	// URLParams 追加到连接串的自定义参数，形如 key=value&key2=value2（同名时覆盖上面的默认值）
	URLParams string `json:"urlParams"`
	// ReadOnly 只读连接：拒绝执行写操作
	ReadOnly bool `json:"readOnly"`
	// IsProduction 生产库标记：界面高亮提示，避免误操作
	IsProduction bool `json:"isProduction"`
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
