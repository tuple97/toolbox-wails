package services

import "testing"

// TestQuoteMySQLIdent 校验标识符转义。
//
// `SHOW CREATE TABLE` 的表名来自 SQL 里的限定名与元数据，直接拼进语句时
// 反引号必须双写 —— 否则名字里带反引号就能越出标识符边界，拼出别的语句。
// 中文表名不加引号在本项目里也合法，但这里统一加引号更稳（与前端生成器一致）。
func TestQuoteMySQLIdent(t *testing.T) {
	cases := map[string]string{
		"users":      "`users`",
		"中文表":        "`中文表`",
		"weird`name": "`weird``name`",
		"back``tick": "`back````tick`",
	}
	for in, want := range cases {
		if got := quoteMySQLIdent(in); got != want {
			t.Errorf("quoteMySQLIdent(%q) = %q, want %q", in, got, want)
		}
	}
}
