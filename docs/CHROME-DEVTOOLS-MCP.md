# Chrome DevTools MCP — 本项目使用说明

## 安装状态

已安装为本地 devDependency：

```bash
npm ls chrome-devtools-mcp
# chrome-devtools-mcp@1.7.0
```

## ⚠️ 关键限制（决定配置方案）

| 功能 | pipe（MCP 启动 Chrome） | browserUrl/wsEndpoint（连接已有 Chrome）|
|------|------------------------|--------------------------------------|
| 基础网页操作（click/navigate/screenshot/evaluate） | ✅ | ✅ |
| 扩展工具（install_extension / trigger_extension_action / list_extensions / reload_extension） | ✅ | ❌ Chrome 149 前不支持 |
| 性能/网络/仿真工具 | ✅ | ✅ |

**结论**：如果需要用 `trigger_extension_action` 模拟"点击扩展图标"打开 popup，**必须**让 MCP 通过 pipe 方式启动 Chrome。连接已有 Chrome 实例时这些工具不可用。

## 方案 A：Pipe 连接 + 扩展工具（推荐）

MCP 启动 Chrome，但指定已有的 user-data-dir 保留登录态，并自动加载 dist-test 扩展。

### MCP Server 配置

将以下配置添加到 ZCode / Claude Code / Cursor 等客户端的 MCP 配置中：

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "chrome-devtools-mcp",
        "--categoryExtensions=true",
        "--usageStatistics=false",
        "--categoryPerformance=false",
        "--categoryNetwork=false",
        "--categoryEmulation=false",
        "--headless=false",
        "--userDataDir", "./.chrome-profile",
        "--chromeArg", "--load-extension=dist-test",
        "--chromeArg", "--no-first-run",
        "--chromeArg", "--disable-infobars"
      ]
    }
  }
}
```

### 使用流程

1. **首次准备**（手动一次）：
   - 确保 `npm run test:build` 已生成 `dist-test/`
   - MCP 启动的 Chrome 会复用 `./.chrome-profile` 目录（首次为空）
   - 在 MCP 管理的 Chrome 中手动登录雪球/同花顺/集思录
   - 扩展已自动加载，在 `chrome://extensions` 确认 `时光机 (test)` 已启用

2. **日常测试**：
   - MCP 启动时自动加载扩展 + 复用登录态 profile
   - 使用 `trigger_extension_action` 点击扩展图标打开 popup
   - 使用 `navigate` 到目标网页进行测试

### 可用扩展工具

- `install_extension(path)` — 安装未打包扩展（如重新加载 dist-test）
- `list_extensions()` — 列出扩展获取 ID
- `reload_extension(id)` — 重载扩展（代码变更后）
- `trigger_extension_action(id)` — **点击扩展图标**（打开 popup）
- `uninstall_extension(id)` — 卸载

## 方案 B：连接已有 Chrome（无扩展工具）

如果你已经手动启动了 Chrome（带远程调试端口），只想用 MCP 做网页操作：

1. 启动 Chrome 时加远程调试参数：
   ```bash
   "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
     --remote-debugging-port=9222 ^
     --load-extension=dist-test
   ```

2. MCP 配置：
   ```json
   {
     "mcpServers": {
       "chrome-devtools": {
         "command": "npx",
         "args": [
           "chrome-devtools-mcp",
           "--browserUrl", "http://127.0.0.1:9222",
           "--usageStatistics=false"
         ]
       }
     }
   }
   ```

3. **限制**：无法使用 `trigger_extension_action`。替代方案：
   - 用 `navigate` 直接打开 `chrome-extension://<扩展ID>/src/popup/index.html`
   - 扩展 ID 从 `dist-test/manifest.json` 的 key 计算，或在 chrome://extensions 查看

## 测试策略建议

对 VERIFY-CHECKLIST 的各章节：

| 章节 | 推荐方案 | 关键工具 |
|------|---------|---------|
| 1.x 引导页 | 方案 A | trigger_extension_action + navigate |
| 2.x 授权模型 | 方案 A | trigger_extension_action + navigate + DOM 断言 |
| 3.x Popup 时间设置 | 方案 A | trigger_extension_action 打开 popup，evaluate 读写控件 |
| 4.x 过滤执行 | 方案 A/B | navigate 到目标页，evaluate 检查 data-tm-filtered |
| 5.x 雪球首页类别 | 方案 A/B | click + evaluate + screenshot |
| 6.x 虚拟分页 | 方案 A/B | click + DOM 断言 + screenshot |
| 7.x 评论过滤 | 方案 A/B | navigate 到帖子详情页 + DOM 断言 |
| 8 快捷键 | ❌ 较难 | keypress 可能受限于 Chrome 扩展快捷键权限 |
| 9.x 失效检测 | 方案 A/B | navigate + evaluate + 等待模态出现 |
| 10.x 其他平台 | 方案 A/B | 同 5.x |
| 12 性能 | 方案 A/B | start_recording / stop_recording（需启用 performance 类别）|

## 参考

- 完整工具列表：`npx chrome-devtools-mcp --categoryExtensions=true --help`
- 项目仓库：https://github.com/ChromeDevTools/chrome-devtools-mcp
- 扩展工具限制说明：见 `--categoryExtensions` help 文本
