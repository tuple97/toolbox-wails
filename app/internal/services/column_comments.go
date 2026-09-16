package services

import (
	"context"
	"database/sql"
	"regexp"
	"strings"
)

/*
 * 结果列的「注释」补全。
 *
 * database/sql 的 ColumnType 只提供类型名，拿不到注释；注释只存在数据库自己的
 * 数据字典里（MySQL 的 information_schema.columns.column_comment）。所以结果
 * 返回前用语句里出现的表名反查一次字典：列名能对上就填注释，对不上（表达式列、
 * 别名列、聚合列）留空 —— 前端只在有值时展示那一行。
 *
 * 只做 MySQL / MariaDB：PostgreSQL 的注释在 pg_description 里需要额外 join，
 * 收益有限，暂不处理（那里的结果列注释恒为空）。
 */

// annotateColumnComments 就地给结果列补注释。
//
// 失败时静默跳过：注释只是展示增强，绝不能因为查字典失败而让整个查询失败。
// 调用方应传入独立的短超时 ctx，避免与主查询抢时间。
func annotateColumnComments(
	ctx context.Context,
	db rowQueryer,
	dbType string,
	database string,
	query string,
	columns []ColumnMeta,
) {
	if len(columns) == 0 || isPostgresType(dbType) {
		return
	}

	tables := fromTables(query)
	if len(tables) == 0 {
		return
	}

	placeholders := make([]string, 0, len(tables))
	args := make([]any, 0, len(tables)+1)
	args = append(args, schemaName(database, dbType))
	for _, table := range tables {
		placeholders = append(placeholders, "?")
		args = append(args, table)
	}

	rows, err := db.QueryContext(ctx, `
		SELECT column_name, column_comment
		FROM information_schema.columns
		WHERE table_schema = ? AND table_name IN (`+strings.Join(placeholders, ",")+`)`, args...)
	if err != nil {
		return
	}
	defer rows.Close()

	/*
	 * 结果列不带表名（`SELECT u.id, o.id` 两列同名），因此只能按列名匹配；
	 * 多表出现同名列时取第一个非空注释 —— 有歧义时宁可给一个接近的，
	 * 也不因为「不确定」而整列不显示。
	 */
	comments := make(map[string]string, len(columns))
	for rows.Next() {
		var name, comment sql.NullString
		if err := rows.Scan(&name, &comment); err != nil {
			return
		}
		comment = sql.NullString{String: strings.TrimSpace(comment.String), Valid: comment.Valid}
		if comment.String == "" {
			continue
		}
		key := strings.ToLower(name.String)
		if _, exists := comments[key]; !exists {
			comments[key] = comment.String
		}
	}
	if err := rows.Err(); err != nil {
		return
	}

	for i := range columns {
		if comment, ok := comments[strings.ToLower(columns[i].Name)]; ok {
			columns[i].Comment = comment
		}
	}
}

// 语句里的表来源：FROM / JOIN 之后。
var fromJoinPattern = regexp.MustCompile(`(?is)\b(?:from|join)\s+`)

// 一次解析最多关注这么多张表，避免超长 IN 列表把字典查询拖慢
const maxCommentTables = 8

/*
 * fromTables 从语句里取出表名（去重、去 schema 前缀）。
 *
 * 这是补全用扫描器在服务端的极简版：只认 FROM / JOIN 后面的标识符，
 * `FROM (SELECT …)` 这种子查询直接跳过（它内部的 FROM 会被另一次匹配捕获）。
 * CTE 名也会被当成表名 — 字典里查不到，自然没有注释，无副作用。
 */
func fromTables(query string) []string {
	seen := make(map[string]bool)
	tables := make([]string, 0, 4)

	// 先剥掉注释与单引号字符串：里面的 from / join 不是表来源
	clean := stripLiterals(query)

	for _, match := range fromJoinPattern.FindAllStringIndex(clean, -1) {
		name := qualifiedNameTail(clean[match[1]:])
		if name == "" {
			continue
		}
		key := strings.ToLower(name)
		if seen[key] {
			continue
		}
		seen[key] = true
		tables = append(tables, name)
		if len(tables) >= maxCommentTables {
			break
		}
	}
	return tables
}

/*
 * stripLiterals 把注释与单引号字符串替换为空格。
 *
 * 保留反引号 / 双引号（MySQL 里可能是标识符，表名靠它们包着），
 * 只清理确定是「非结构文本」的部分。
 */
func stripLiterals(query string) string {
	builder := strings.Builder{}
	builder.Grow(len(query))

	for i := 0; i < len(query); {
		switch {
		case strings.HasPrefix(query[i:], "--"), query[i] == '#':
			builder.WriteByte(' ')
			if next := strings.IndexByte(query[i:], '\n'); next >= 0 {
				i += next + 1
				continue
			}
			i = len(query)

		case strings.HasPrefix(query[i:], "/*"):
			builder.WriteByte(' ')
			if next := strings.Index(query[i:], "*/"); next >= 0 {
				i += next + 2
				continue
			}
			i = len(query)

		case query[i] == '\'':
			builder.WriteByte(' ')
			i++
			for i < len(query) {
				if query[i] == '\\' {
					i += 2
					continue
				}
				if query[i] == '\'' {
					// '' 是转义的单引号，字符串还没结束
					if i+1 < len(query) && query[i+1] == '\'' {
						i += 2
						continue
					}
					i++
					break
				}
				i++
			}

		default:
			builder.WriteByte(query[i])
			i++
		}
	}
	return builder.String()
}

/*
 * qualifiedNameTail 读出一段限定名的最后一段（表名），读不到返回空串。
 *
 * 支持 `db`.`t`、db.t、t 三种写法；`(` 开头（子查询）直接判为读不到。
 */
func qualifiedNameTail(text string) string {
	index := 0
	last := ""

	for {
		index = skipSpaceAndComments(text, index)
		segment, next := readIdentSegment(text, index)
		if segment == "" {
			break
		}
		last = segment
		index = skipSpaceAndComments(text, next)
		if index >= len(text) || text[index] != '.' {
			break
		}
		index++ // 跳过点号，继续读下一段（最终只保留最后一段）
	}
	return last
}

// readIdentSegment 读一个标识符段：反引号 / 双引号包裹，或裸标识符。
func readIdentSegment(text string, start int) (string, int) {
	if start >= len(text) {
		return "", start
	}

	switch text[start] {
	case '`', '"':
		quote := text[start]
		if end := strings.IndexByte(text[start+1:], quote); end >= 0 {
			return text[start+1 : start+1+end], start + 1 + end + 1
		}
		return "", start
	}

	end := start
	for end < len(text) && isSQLIdentChar(text[end]) {
		end++
	}
	if end == start {
		return "", start
	}
	return text[start:end], end
}

// skipSpaceAndComments 跳过空白与 `--` / `/* */` 注释。
func skipSpaceAndComments(text string, start int) int {
	index := start
	for index < len(text) {
		switch {
		case text[index] == ' ' || text[index] == '\t' || text[index] == '\n' || text[index] == '\r':
			index++
		case strings.HasPrefix(text[index:], "--"), text[index] == '#':
			if next := strings.IndexByte(text[index:], '\n'); next >= 0 {
				index += next + 1
				continue
			}
			return len(text)
		case strings.HasPrefix(text[index:], "/*"):
			if next := strings.Index(text[index:], "*/"); next >= 0 {
				index += next + 2
				continue
			}
			return len(text)
		default:
			return index
		}
	}
	return index
}
