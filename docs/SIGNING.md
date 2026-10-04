# 代码签名

## Windows

未签名的 exe 在 Windows 上会触发 SmartScreen 的“未知发布者”提示。CI 在配置了下面两个仓库 Secret 时自动签名，没有配置时照常构建未签名版本。

| Secret | 内容 |
|---|---|
| `WIN_CSC_LINK` | 代码签名证书（`.pfx` / `.p12`）的 base64 文本，或一个可下载该文件的 HTTPS 地址 |
| `WIN_CSC_KEY_PASSWORD` | 证书密码 |

生成 base64：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) | Set-Clipboard
```

在仓库的 Settings → Secrets and variables → Actions 中添加。electron-builder 通过环境变量 `CSC_LINK` 与 `CSC_KEY_PASSWORD` 读取它们（见 `.github/workflows/ci.yml`）。

说明：

- 普通（OV）证书签名后，SmartScreen 仍需要积累下载量才会停止提示；EV 证书立即生效，但私钥通常在硬件令牌里，不能直接放进 CI。
- 开源项目可以申请 [SignPath Foundation](https://signpath.org/) 的免费签名服务。
- 不要把证书文件或密码提交到仓库。

## macOS

没有证书时，`macos.yml` 对应用做 ad-hoc 签名：能运行，但用户第一次打开要手动放行（见 [MACOS.md](MACOS.md)）。配置下面的 Secret 后，工作流改为用开发者证书签名并提交 Apple 公证，用户双击即可打开。

| Secret | 内容 |
|---|---|
| `MAC_CSC_LINK` | “Developer ID Application” 证书导出的 `.p12` 的 base64 文本 |
| `MAC_CSC_KEY_PASSWORD` | 导出 `.p12` 时设置的密码 |
| `APPLE_ID` | Apple 开发者账号的邮箱 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 在 appleid.apple.com 生成的“App 专用密码” |
| `APPLE_TEAM_ID` | 开发者团队 ID（10 位字母数字） |

需要加入 Apple Developer Program（按年付费）。生成 base64：`base64 -i certificate.p12 | pbcopy`。后三项缺失时只签名、不公证，Gatekeeper 仍会提示。

应用启用了 Hardened Runtime，权限声明在 `build/entitlements.mac.plist`：允许 JIT（Electron 需要）和加载应用包内自带的库（内置的 Python 引擎需要）。
