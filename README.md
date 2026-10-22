# AetherPlay

> 面向 Android 的本地网页游戏播放器，重点优化 WOLF RPG 的按需资源读取、外部存档读写与移动端操作体验。

AetherPlay 基于 [popupie/local-web-game-player](https://github.com/popupie/local-web-game-player) 开发。它将本地游戏目录接入 Android WebView，为 WOLF RPG 等网页化游戏提供专用运行环境、触控 UI、诊断日志，以及对 Android 共享存储中游戏文件的直接访问。

## 这个项目解决什么问题？

在手机上运行本地网页游戏时，通用浏览器和简单的 WebView 包装器往往会遇到几类问题：移动端触控和画面布局不合适；大型游戏资源需要一次性复制或展开；游戏保存到浏览器虚拟文件系统后，存档不一定会落回玩家原来的游戏目录；Android 的 Storage Access Framework（SAF）还可能暴露出目录大小写与重名处理差异。

AetherPlay 的目标是尽量保留游戏原有运行方式，同时让本地资源读取、WOLF RPG 存档持久化和 Android 文件访问之间有明确、可诊断的桥接层。

## 核心能力

- **Android 本地目录运行**：通过系统目录选择器获得玩家选定游戏目录的 SAF 授权，不要求把整份游戏先复制进应用私有目录。
- **按需读取游戏资源**：为已登记的游戏资源提供本地路由，游戏请求时再从 Android 文件提供器读取；减少启动时批量物化资源造成的等待和重复占用。
- **WOLF RPG 外部存档读写**：桥接 BrowserWoditor 的虚拟文件系统与玩家所选游戏目录中的 `save/SaveDataNN.sav` 文件，让保存结果落回外部游戏目录。
- **复用已有存档目录**：SAF 子项查找对目录和文件名大小写不敏感，能够复用原有的 `save` 或 `Save`，避免因大小写差异产生 `Save (1)`、`Save (2)` 等重复目录。
- **写入校验与诊断日志**：存档通过临时文件/回读校验流程写入；运行日志记录同步、扫描、写入成功或失败，方便在 Android 上定位问题。
- **面向手机的沉浸式 UI**：优化横竖屏、触控操作、全屏布局、悬浮设置和诊断日志导出。

## WOLF RPG 存档是怎样工作的？

BrowserWoditor 仍使用其 Emscripten 虚拟文件系统与 IDBFS/IndexedDB。AetherPlay 不直接改写游戏存档格式，而是在 Android 文件访问层与 BrowserWoditor 之间加入受限的读写桥接：

1. **注册游戏目录**：播放器将当前游戏 ID 与玩家授权的 SAF 目录关联。
2. **读取外部存档**：当运行时访问 `Save/SaveDataNN.sav` 时，桥接层尝试从选定目录读取已有文件，并将内容提供给虚拟文件系统。
3. **等待虚拟存储完成同步**：运行时在 BrowserWoditor 创建 `-GameCache`、`-Save` IDBFS 挂载后安装同步钩子；只有非初始化同步成功后才触发存档扫描。
4. **收集有效存档**：扫描 `/data0/<projectId>-GameCache/Save/` 与 `/data0/<projectId>-Save/Save/`，只接受 `SaveData` 数字槽位的 `.sav` 文件；跳过空文件和超过 16 MiB 的文件，并优先采用运行中的 `GameCache` 副本。
5. **发送到 Android 宿主**：通过受限的 `postMessage` 发送游戏 ID、相对路径和文件字节；宿主确认消息来自当前游戏 iframe，并验证路径和大小。
6. **写入 SAF 目录**：原生 Android 插件在玩家授权的游戏目录中更新对应存档；写入后回读校验字节，并输出 SHA-256 诊断信息。

更完整的路径、边界和诊断事件说明见 [Android WOLF 存档持久化设计](docs/ANDROID_WOLF_SAVE_STORAGE.md)。

## 存档实现的边界

- 目前这条外部写回桥接面向 `Save/SaveDataNN.sav` 格式的 WOLF RPG 存档，不是任意文件同步器，也不负责解密或转换存档格式。
- 单个存档写入限制为 16 MiB；空文件不会覆盖已有有效存档。
- IDBFS/IndexedDB 仍是 BrowserWoditor 运行时的中间持久化层；外部目录是与游戏文件并列、便于管理和备份的存档位置。
- SAF 文件提供器对临时文件、重命名、回读等操作的支持可能不同，因此原生写入逻辑会验证最终字节是否与待写内容一致，并在失败时记录错误。

## 开发与构建

环境要求：Node.js `>=22`、pnpm `>=11`、Android SDK/NDK 与可用的 Gradle 环境。

```bash
pnpm install
pnpm build
npx cap sync android
cd android
./gradlew assembleDebug
```

Debug APK 输出路径：`android/app/build/outputs/apk/debug/app-debug.apk`。

## 致谢与许可 / Acknowledgements & License

AetherPlay 基于 [local-web-game-player](https://github.com/popupie/local-web-game-player) 开发，感谢 popupie 及上游贡献者提供坚实的底层运行环境。

原项目与 AetherPlay 的修改均按 MIT License 发布。再分发时请保留以下版权与许可声明。

> Copyright (c) 2025 popupie (Original Project)
> Copyright (c) 2025 AetherPlay Contributors
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.
