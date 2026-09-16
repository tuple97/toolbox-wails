package services

import (
	"reflect"
	"testing"
)

func TestFromTables(t *testing.T) {
	cases := []struct {
		name  string
		query string
		want  []string
	}{
		{
			name:  "单表",
			query: "SELECT * FROM users",
			want:  []string{"users"},
		},
		{
			name:  "限定名取最后一段",
			query: "SELECT u.id FROM `db`.`users` u",
			want:  []string{"users"},
		},
		{
			name:  "JOIN 两张表并去重",
			query: "SELECT * FROM users u JOIN orders o ON o.user_id = u.id JOIN users u2 ON 1 = 1",
			want:  []string{"users", "orders"},
		},
		{
			name:  "子查询：跳过括号本身，仍能取到内部的表",
			query: "SELECT * FROM (SELECT * FROM orders) t",
			want:  []string{"orders"},
		},
		{
			name:  "注释里的 from 不算",
			query: "SELECT * FROM /* from fake */ users",
			want:  []string{"users"},
		},
		{
			name:  "没有表来源",
			query: "SELECT 1",
			want:  []string{},
		},
		{
			name:  "字符串里的 from 不算",
			query: "SELECT * FROM users WHERE name = 'from orders'",
			want:  []string{"users"},
		},
		{
			name:  "CTE：按出现顺序收集（CTE 名查不到注释，无副作用）",
			query: "WITH c AS (SELECT * FROM users) SELECT * FROM c",
			want:  []string{"users", "c"},
		},
	}

	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			got := fromTables(item.query)
			if len(got) == 0 && len(item.want) == 0 {
				return
			}
			if !reflect.DeepEqual(got, item.want) {
				t.Fatalf("fromTables(%q) = %v, 期望 %v", item.query, got, item.want)
			}
		})
	}
}
