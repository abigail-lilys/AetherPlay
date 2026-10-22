# Changelog

本文件记录对使用者有影响的变更。版本号与公开 APK Release 应在代码合入并完成构建后同步更新。

## v1.1.0 — 2026-10-22

### Added

- 为 Android 外部 WOLF RPG 存档读写增加可追踪的生命周期日志，覆盖 IDBFS 挂载、同步、槽位扫描、消息发布与原生写入结果。
- 增加完整的 Android WOLF 存档持久化设计文档，说明读写路径、消息边界、失败定位方法与已验证范围。

### Fixed

- 在 BrowserWoditor 创建 IDBFS 挂载后安装同步钩子，避免只在初始化时枚举挂载而错过实际存档同步。
- SAF 目录和文件查找改为名称大小写不敏感，复用已有 `save/` 与存档文件，避免重复生成 `Save (1)` 等目录。
- 阻止 0 字节临时存档覆盖已有有效槽位，并对外部文件写入执行回读验证。

### Verified

- `pnpm build` 通过。
- `npx cap sync android` 通过。
- Android 运行日志确认多个 WOLF 存档槽位写入外部目录完成，且没有继续创建重复的 Save 文件夹。

## v1.0.0

- 首个公开 Android APK Release。详见 [GitHub Releases](https://github.com/abigail-lilys/AetherPlay/releases)。
