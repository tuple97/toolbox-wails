package services

import (
	"errors"
	"fmt"
	"strconv"

	"toolbox-wails/app/internal/database"
)

// 配置项类型
const (
	SettingTypeString  = "string"
	SettingTypeNumber  = "number"
	SettingTypeBoolean = "boolean"
	SettingTypeJSON    = "json"
	SettingTypeArray   = "array"
)

// defaultSettings 内置默认配置。
// 首次读取时若表为空则写入，保证前端总能拿到完整配置。
var defaultSettings = []database.Setting{
	{Key: "theme", Type: SettingTypeString, Value: "dark"},
	{Key: "font_size", Type: SettingTypeNumber, Value: "13"},
	{Key: "control_size", Type: SettingTypeString, Value: "default"},
	{Key: "editor_font_size", Type: SettingTypeNumber, Value: "13"},
	{Key: "log_max_lines", Type: SettingTypeNumber, Value: "200"},
	// 窗口背景：透明度百分比（100 为不透明）与磨砂模糊半径（px，0 为关闭）
	{Key: "background_alpha", Type: SettingTypeNumber, Value: "100"},
	{Key: "background_blur", Type: SettingTypeNumber, Value: "0"},
	// 界面字体标识（取值见前端 utils/fonts.ts）
	{Key: "font_family", Type: SettingTypeString, Value: "system"},
	// 编辑器字体标识，独立于界面字体；取值规则同 font_family
	{Key: "editor_font_family", Type: SettingTypeString, Value: "system"},
}

// SettingService 负责全局配置的读写。
type SettingService struct {
	repo *database.Repository
}

// NewSettingService 创建配置服务。
func NewSettingService(repo *database.Repository) *SettingService {
	return &SettingService{repo: repo}
}

// ListAll 返回全部配置项。
// 首次调用（表为空）时会写入默认值，避免前端面对空配置需要到处兜底。
func (s *SettingService) ListAll() ([]database.Setting, error) {
	count, err := s.repo.CountSettings()
	if err != nil {
		return nil, err
	}

	if count == 0 {
		if err := s.seedDefaults(); err != nil {
			return nil, err
		}
	}

	list, err := s.repo.ListSettings()
	if err != nil {
		return nil, err
	}

	// 补齐后续版本新增的配置项（表非空但缺少新 key 的情况）
	existing := make(map[string]struct{}, len(list))
	for _, item := range list {
		existing[item.Key] = struct{}{}
	}
	for _, def := range defaultSettings {
		if _, ok := existing[def.Key]; ok {
			continue
		}
		if err := s.repo.UpsertSetting(def); err != nil {
			return nil, err
		}
		list = append(list, def)
	}

	return list, nil
}

// Save 写入配置项。
//
// 会依据 key 的已知类型做校验，避免存入无法解析的值
// （例如把 font_size 设成 "abc"，前端解析时会出错）。
func (s *SettingService) Save(key, value string) error {
	if key == "" {
		return errors.New("配置项名称不能为空")
	}

	settingType := s.typeOf(key)
	switch settingType {
	case SettingTypeNumber:
		if _, err := strconv.ParseFloat(value, 64); err != nil {
			return fmt.Errorf("配置 %s 需要数字，收到 %q", key, value)
		}
	case SettingTypeBoolean:
		if value != "true" && value != "false" {
			return fmt.Errorf("配置 %s 需要布尔值（true/false），收到 %q", key, value)
		}
	}

	return s.repo.UpsertSetting(database.Setting{
		Key:   key,
		Type:  settingType,
		Value: value,
	})
}

// typeOf 返回配置项的类型；未知 key 按字符串处理，便于扩展自定义配置。
func (s *SettingService) typeOf(key string) string {
	for _, def := range defaultSettings {
		if def.Key == key {
			return def.Type
		}
	}
	return SettingTypeString
}

// seedDefaults 写入默认配置。
func (s *SettingService) seedDefaults() error {
	for _, def := range defaultSettings {
		if err := s.repo.UpsertSetting(def); err != nil {
			return err
		}
	}
	return nil
}
