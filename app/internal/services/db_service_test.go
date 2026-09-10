package services

import "testing"

// TestBuildCountSQL 覆盖统计总数 SQL 的生成规则：
// 简单查询应改写为 COUNT(*) 并去掉排序，复杂查询回退为子查询。
func TestBuildCountSQL(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "简单查询改写并去掉排序",
			in:   "SELECT id, name FROM users WHERE status = 1 ORDER BY id DESC",
			want: "SELECT COUNT(*) FROM users WHERE status = 1",
		},
		{
			name: "最外层 FROM 之后的内容整体保留",
			in:   "SELECT a FROM (SELECT * FROM t) AS s ORDER BY a",
			want: "SELECT COUNT(*) FROM (SELECT * FROM t) AS s",
		},
		{
			name: "分号被清理",
			in:   "SELECT a FROM t;",
			want: "SELECT COUNT(*) FROM t",
		},
		{
			name: "字符串中的 order by 不被误截断",
			in:   "SELECT a FROM t WHERE name = 'order by x' ORDER BY a",
			want: "SELECT COUNT(*) FROM t WHERE name = 'order by x'",
		},
		{
			name: "窗口函数内的 order by 不影响最外层",
			in:   "SELECT ROW_NUMBER() OVER (ORDER BY id) AS rn FROM t",
			want: "SELECT COUNT(*) FROM t",
		},
		{
			name: "group by 回退子查询",
			in:   "SELECT a, COUNT(*) FROM t GROUP BY a",
			want: "SELECT COUNT(*) FROM (SELECT a, COUNT(*) FROM t GROUP BY a) AS __toolbox_total",
		},
		{
			name: "distinct 回退子查询",
			in:   "SELECT DISTINCT a FROM t",
			want: "SELECT COUNT(*) FROM (SELECT DISTINCT a FROM t) AS __toolbox_total",
		},
		{
			name: "union 回退子查询并去掉排序",
			in:   "SELECT a FROM t1 UNION SELECT a FROM t2 ORDER BY a",
			want: "SELECT COUNT(*) FROM (SELECT a FROM t1 UNION SELECT a FROM t2) AS __toolbox_total",
		},
		{
			name: "CTE 回退子查询",
			in:   "WITH c AS (SELECT 1) SELECT * FROM c ORDER BY 1",
			want: "SELECT COUNT(*) FROM (WITH c AS (SELECT 1) SELECT * FROM c) AS __toolbox_total",
		},
		{
			name: "只有 order by 时被整体去掉",
			in:   "SELECT a FROM t ORDER BY a",
			want: "SELECT COUNT(*) FROM t",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := buildCountSQL(tc.in)
			if got != tc.want {
				t.Fatalf("buildCountSQL()\n got: %s\nwant: %s", got, tc.want)
			}
		})
	}
}

// TestApplyPagination 校验分页 SQL 的生成：
// 无自带 limit 时直接追加，已有 limit/offset 时包一层派生表。
func TestApplyPagination(t *testing.T) {
	cases := []struct {
		name     string
		in       string
		pageSize int
		offset   int
		want     string
	}{
		{
			name:     "第一页只追加 LIMIT",
			in:       "SELECT * FROM users WHERE 1=1",
			pageSize: 20,
			offset:   0,
			want:     "SELECT * FROM users WHERE 1=1\nLIMIT 20",
		},
		{
			name:     "后续页追加 LIMIT OFFSET",
			in:       "SELECT * FROM users ORDER BY id",
			pageSize: 20,
			offset:   40,
			want:     "SELECT * FROM users ORDER BY id\nLIMIT 20 OFFSET 40",
		},
		{
			name:     "末尾行注释不影响追加",
			in:       "SELECT * FROM users -- 全部用户",
			pageSize: 20,
			offset:   0,
			want:     "SELECT * FROM users -- 全部用户\nLIMIT 20",
		},
		{
			name:     "原 SQL 自带 limit 时包一层",
			in:       "SELECT * FROM users LIMIT 10",
			pageSize: 20,
			offset:   0,
			want:     "SELECT * FROM (SELECT * FROM users LIMIT 10) AS __toolbox_page LIMIT 20 OFFSET 0",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := applyPagination(tc.in, tc.pageSize, tc.offset)
			if got != tc.want {
				t.Fatalf("applyPagination()\n got: %s\nwant: %s", got, tc.want)
			}
		})
	}
}

// TestIndexOfTopLevelKeyword 校验关键字定位不会被括号、引号与注释干扰。
func TestIndexOfTopLevelKeyword(t *testing.T) {
	cases := []struct {
		name    string
		query   string
		keyword string
		want    int
	}{
		{name: "最外层命中", query: "select a from t order by a", keyword: "from", want: 9},
		{name: "括号内不算", query: "select (select a from t) from u", keyword: "from", want: 25},
		{name: "单引号内不算", query: "select 'from' from t", keyword: "from", want: 14},
		{name: "行注释内不算", query: "select a -- from t\nfrom u", keyword: "from", want: 19},
		{name: "标识符中的关键字不算", query: "select order_type from t", keyword: "order", want: -1},
		{name: "未命中", query: "select a from t", keyword: "group by", want: -1},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := indexOfTopLevelKeyword(tc.query, tc.keyword)
			if got != tc.want {
				t.Fatalf("indexOfTopLevelKeyword() = %d, want %d", got, tc.want)
			}
		})
	}
}
