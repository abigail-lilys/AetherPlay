# 关键问题解决说明

## 问题 2：日志生成多个文件
**问题表现**：每次启动游戏都会生成 `runtime.log.txt`、`runtime.log.txt (1)` 等多个副本。
**解决方案**：修改原生层 `AndroidFolderPickerPlugin.java`。
- 废弃了原本无脑调用 `DocumentsContract.createDocument` 的逻辑。
- 新增 `getOrCreateLogUri` 方法：先通过 SAF 遍历查找是否已存在 `runtime.log.txt`。若存在则直接复用其 Uri，不存在才创建。
- 写入模式从 `"wt"`（截断写入）改为 `"wa"`（追加写入）。
- 每次启动时，自动在文件尾部写入 `---- session YYYY-MM-DD HH:mm:ss ----` 分隔头。
**验证结果**：多次重启游戏，`runtime.log.txt` 始终只有单文件，且内容持续追加。

## 问题 3：加载时间过长（从 26 秒优化至 1~2 秒）
**问题表现**：游戏加载时，前端会预先读取全部 610 个静态资源（约 194MB），并通过 Capacitor 的 JS 桥接传输，导致加载卡顿长达 26 秒。
**解决方案**：双管齐下，废弃全量预读，转为原生按需流式拦截。
1. **前端跳过预读**：修改 `src/lib/playerUrls.ts` 与 `src/lib/wolfAssets.ts`，直接跳过 `wolf-assets.read` 环节，将 iframe 的 `src` 指向 `/__game__/index.html`。
2. **原生流式拦截**：新增 `GameWebViewClient.java`，并在 `MainActivity.java` 中注入。
   - 拦截所有 `/__game__/*` 的请求。
   - 根据 URL 解析出真实文件路径（如 `/storage/emulated/0/ApkWolfRpg/mi-test/index.html`）。
   - 使用 `FileInputStream` 直接向 WebView 返回流式的 `WebResourceResponse`。
   - 加入路径穿越校验（`getCanonicalPath`），防止 `../` 安全漏洞。
**验证结果**：根据最新运行日志，`wolf-assets.read` 已被彻底跳过，加载时间从 `elapsedMs: 24521` 降至 `elapsedMs: 8`，游戏秒开。

## 附加
- 移除了 `useGameControls.ts` 中用于诊断侧边栏布局的探针代码（`WOLF_TOUCH_UI_RESTORE_PATCH`）。
