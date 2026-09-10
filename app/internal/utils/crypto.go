// Package utils 提供密码加解密与 SQL 变量解析等通用能力。
package utils

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// 加密前缀，便于识别密文并兼容未来算法升级。
const cipherPrefix = "enc:v1:"

// keyFileName 保存随机生成的密钥，位于数据目录内。
const keyFileName = ".secret.key"

// Cipher 封装 AES-GCM 加解密。
type Cipher struct {
	key []byte
}

// NewCipher 从数据目录加载或生成密钥。
//
// 说明：密钥以随机值生成并保存于数据目录，权限设为仅当前用户可读。
// 相比写死密钥更安全；相比依赖系统钥匙串则免去平台差异与额外依赖。
func NewCipher(dataDir string) (*Cipher, error) {
	if dataDir == "" {
		dataDir = "."
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("创建密钥目录失败: %w", err)
	}

	keyPath := filepath.Join(dataDir, keyFileName)
	raw, err := os.ReadFile(keyPath)

	switch {
	case errors.Is(err, os.ErrNotExist):
		// 首次运行：生成 32 字节随机密钥
		generated := make([]byte, 32)
		if _, randErr := io.ReadFull(rand.Reader, generated); randErr != nil {
			return nil, fmt.Errorf("生成密钥失败: %w", randErr)
		}
		if writeErr := os.WriteFile(keyPath, generated, 0o600); writeErr != nil {
			return nil, fmt.Errorf("保存密钥失败: %w", writeErr)
		}
		return &Cipher{key: generated}, nil
	case err != nil:
		return nil, fmt.Errorf("读取密钥失败: %w", err)
	}

	if len(raw) == 0 {
		return nil, errors.New("密钥文件为空，请删除后重启应用以重新生成")
	}
	return &Cipher{key: raw}, nil
}

// Encrypt 加密明文，返回带前缀的 Base64 密文。
// 空字符串直接返回空，避免无意义加密。
func (c *Cipher) Encrypt(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	if c == nil || len(c.key) == 0 {
		return "", errors.New("加密器未初始化")
	}

	block, err := aes.NewCipher(c.key)
	if err != nil {
		return "", fmt.Errorf("创建 AES 失败: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("创建 GCM 失败: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("生成 nonce 失败: %w", err)
	}

	// nonce 前置到密文，解密时按长度切分
	sealed := gcm.Seal(nonce, nonce, []byte(plain), nil)
	return cipherPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt 解密由 Encrypt 产生的密文。
// 无前缀的输入视为历史明文，原样返回，保证兼容性。
func (c *Cipher) Decrypt(encoded string) (string, error) {
	if encoded == "" {
		return "", nil
	}
	if !strings.HasPrefix(encoded, cipherPrefix) {
		return encoded, nil
	}
	if c == nil || len(c.key) == 0 {
		return "", errors.New("加密器未初始化")
	}

	payload, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(encoded, cipherPrefix))
	if err != nil {
		return "", fmt.Errorf("密文解码失败: %w", err)
	}

	block, err := aes.NewCipher(c.key)
	if err != nil {
		return "", fmt.Errorf("创建 AES 失败: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("创建 GCM 失败: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(payload) < nonceSize {
		return "", errors.New("密文长度不足，可能已损坏")
	}

	nonce, ciphertext := payload[:nonceSize], payload[nonceSize:]
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("解密失败（密钥可能已变更）: %w", err)
	}
	return string(plain), nil
}

// MaskPassword 返回用于界面展示的掩码，避免密文直接暴露。
func MaskPassword(secret string) string {
	if secret == "" {
		return ""
	}
	return strings.Repeat("*", 8)
}

// machineFingerprint 基于机器信息生成指纹。
// 保留该能力用于诊断，当前密钥方案不依赖它，避免换机器后无法解密。
func machineFingerprint() string {
	host, _ := os.Hostname()
	sum := sha256.Sum256([]byte(host + runtime.GOOS + runtime.GOARCH))
	return base64.RawStdEncoding.EncodeToString(sum[:8])
}
