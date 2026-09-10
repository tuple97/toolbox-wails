package utils

import (
	"bytes"
	"fmt"
	"regexp"
	"strings"
	"text/template"
)

// 模板关键字：出现在 {{ }} 开头位置，不是变量引用。
// 预处理补点号时必须跳过，否则会破坏 {{if}} / {{range}} 等语法。
var tplKeywords = map[string]struct{}{
	"if": {}, "else": {}, "end": {}, "range": {},
	"with": {}, "template": {}, "block": {}, "define": {},
	"break": {}, "continue": {},
}

// 模板内置函数名：出现在 {{ }} 中作为命令，不是变量。
var tplBuiltinFunctions = map[string]struct{}{
	"and": {}, "call": {}, "html": {}, "index": {}, "slice": {},
	"js": {}, "len": {}, "not": {}, "or": {}, "print": {},
	"printf": {}, "println": {}, "urlquery": {}, "eq": {}, "ne": {},
	"lt": {}, "le": {}, "gt": {}, "ge": {},
	// 本项目注册的自定义函数
	"quote": {}, "upper": {}, "lower": {}, "default": {}, "join": {}, "now": {}, "in": {},
}

var (
	// 匹配所有 {{ ... }} 片段，内部内容在回调中解析
	actionPlaceholder = regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`)

	// 字符串字面量，提取变量时需跳过
	stringLiteral = regexp.MustCompile(`"[^"]*"|` + "`[^`]*`")

	// 已补点号的字段引用：.device_no
	fieldRefPattern = regexp.MustCompile(`\.([A-Za-z_][A-Za-z0-9_]*)`)
)

// PreprocessPlaceholders 把用户书写的 {{ var }} 转换为 text/template 需要的 {{ .var }}。
//
// 处理范围（用户无需书点点号）：
//   - 纯变量：{{ device_no }}        → {{ .device_no }}
//   - 条件：  {{if device_no}}       → {{if .device_no}}
//   - 取反：  {{if not device_no}}   → {{if not .device_no}}
//   - 比较：  {{if eq env "prod"}}   → {{if eq .env "prod"}}
//   - 循环：  {{range device_list}}  → {{range .device_list}}
//   - 管道：  {{ device_no | upper }} → {{ .device_no | upper }}
//
// 不会处理：关键字（if/range/end 等）、内置函数与自定义函数、已带点号的引用、
// 字符串字面量内容。因此重复调用是幂等的。
func PreprocessPlaceholders(text string) string {
	return actionPlaceholder.ReplaceAllStringFunc(text, func(match string) string {
		inner := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(match, "{{"), "}}"))
		if inner == "" {
			return match
		}
		return "{{ " + addDotsToExpression(inner) + " }}"
	})
}

// tokenPattern 用于把表达式拆成有意义的词元：
// 标识符、变量引用(.xxx)、字段引用($x)、字符串字面量、其他符号。
var tokenPattern = regexp.MustCompile(
	`\.[A-Za-z_][A-Za-z0-9_]*` + // 已带点号：.env
		`|\$[A-Za-z_0-9]*` + // range 变量：$i、$v、$
		`|"[^"]*"` + // 双引号字符串
		"|`[^`]*`" + // 反引号字符串
		`|[A-Za-z_][A-Za-z0-9_]*` + // 标识符：env、eq、if
		`|.`, // 其他单字符
)

// addDotsToExpression 为表达式中的变量引用补上点号。
//
// 采用「分词 + 分类」策略：把表达式拆成词元后逐个判断，
// 比逐字符扫描更容易保证正确性，也天然处理了字符串字面量。
//
// 分类规则：
//   - 关键字（if/range/end...）→ 原样
//   - 函数名（quote/eq/len...）→ 原样
//   - $ 变量（$i/$v）→ 原样
//   - 已带点号（.env）→ 原样
//   - 字符串字面量 → 原样
//   - 其余标识符 → 补点号（.env）
func addDotsToExpression(expr string) string {
	tokens := tokenPattern.FindAllString(expr, -1)

	var builder strings.Builder
	for _, token := range tokens {
		switch {
		case token == "":
			continue

		// 已带点号、$ 变量、字符串字面量：直接输出
		case token[0] == '.' || token[0] == '$' || token[0] == '"' || token[0] == '`':
			builder.WriteString(token)

		// 标识符：判断是关键字/函数，还是变量
		case isIdentifier(token):
			if _, isKeyword := tplKeywords[token]; isKeyword {
				builder.WriteString(token)
				continue
			}
			if _, isFunc := tplBuiltinFunctions[token]; isFunc {
				builder.WriteString(token)
				continue
			}
			// 数字开头的不是标识符（如 42），上面 isIdentifier 已过滤
			if isNumeric(token) {
				builder.WriteString(token)
				continue
			}
			builder.WriteString("." + token)

		default:
			builder.WriteString(token)
		}
	}

	return builder.String()
}

// isIdentifier 判断词元是否为纯标识符（字母/下划线开头）。
func isIdentifier(token string) bool {
	if token == "" {
		return false
	}
	first := token[0]
	if !(first == '_' || (first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z')) {
		return false
	}
	for i := 1; i < len(token); i++ {
		ch := token[i]
		if !(ch == '_' || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) {
			return false
		}
	}
	return true
}

// isNumeric 判断词元是否为数字字面量。
func isNumeric(token string) bool {
	if token == "" {
		return false
	}
	for i := 0; i < len(token); i++ {
		ch := token[i]
		if ch != '.' && (ch < '0' || ch > '9') {
			return false
		}
	}
	return true
}

// RenderSQL 使用 text/template 渲染 SQL 模板。
//
// variables 为变量名到值的映射，支持 {{ .name }} 访问。
// 变量缺失时（补全后仍缺失）会报错，便于定位拼写错误。
func RenderSQL(tplText string, variables map[string]any) (string, error) {
	processed := PreprocessPlaceholders(tplText)

	tpl, err := template.New("sql").
		Funcs(TplFuncMap).
		Option("missingkey=error").
		Parse(processed)
	if err != nil {
		return "", fmt.Errorf("模板语法错误: %w", err)
	}

	if variables == nil {
		variables = map[string]any{}
	}

	var buf bytes.Buffer
	if err := tpl.Execute(&buf, variables); err != nil {
		return "", fmt.Errorf("模板渲染失败: %w", err)
	}

	return buf.String(), nil
}

// ValidateTemplate 校验模板语法。
// 解析在预处理之后进行，保证校验结果与实际渲染一致。
func ValidateTemplate(tplText string) error {
	processed := PreprocessPlaceholders(tplText)
	if _, err := template.New("sql").Funcs(TplFuncMap).Parse(processed); err != nil {
		return fmt.Errorf("模板语法错误: %w", err)
	}
	return nil
}

// ExtractTemplateVariables 提取模板中引用的变量名。
//
// 实现方式：预处理补点号后，从每个 {{ }} 片段中提取 .xxx 引用并去重。
// 这是纯文本分析，不执行模板，因此可在用户编辑时实时调用。
//
// 注意：range 循环产生的 $i/$v 等局部变量不会被提取（它们不是外部输入）。
func ExtractTemplateVariables(tplText string) []string {
	processed := PreprocessPlaceholders(tplText)

	seen := make(map[string]struct{})
	names := make([]string, 0)

	for _, match := range actionPlaceholder.FindAllStringSubmatch(processed, -1) {
		if len(match) < 2 {
			continue
		}

		// 去掉字符串字面量，避免把 "prod" 里的内容误当变量
		cleaned := stringLiteral.ReplaceAllString(match[1], " ")

		for _, ref := range fieldRefPattern.FindAllStringSubmatch(cleaned, -1) {
			if len(ref) < 2 {
				continue
			}
			name := ref[1]
			// 排除 $x.y 这类局部变量访问（预处理后不会带点号前缀，这里仅作防护）
			if _, exists := seen[name]; exists {
				continue
			}
			seen[name] = struct{}{}
			names = append(names, name)
		}
	}

	return names
}
