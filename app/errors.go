package app

import "errors"

// 绑定层共享的错误定义。
// 使用固定文案，便于前端直接展示给用户。
var (
	// errEmptyDictName 词典名称不能为空
	errEmptyDictName = errors.New("词典名称不能为空")
)
