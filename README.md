# AetherPlay

> 沉浸式本地网页游戏运行器，为 WOLF RPG 等引擎提供纯净体验。

**AetherPlay** 是一款专为运行本地网页游戏（如 WOLF RPG 引擎游戏）而打造的高性能 Android 播放器。它彻底打破了传统浏览器运行游戏的束缚，为你提供纯净、无干扰的沉浸式体验。

本项目基于 [popupie/local-web-game-player](https://github.com/popupie/local-web-game-player) 开发，原项目作者为 popupie 及贡献者。我们在其基础上针对移动端进行了深度定制与重构。

## 核心特性

- **纯净去白边**：告别浏览器环境，彻底解决画面裁切与多余边栏问题。
- **原生级触控**：深度优化移动端触控体验，支持无缝方向键拖拽、自定义 UI 布局。
- **沉浸式适配**：自动适配横屏与竖屏，智能隐藏系统状态栏，带来真正的全屏沉浸体验。
- **极速与安全**：全本地离线运行，无需联网，游戏存档与隐私数据安全保留在你的设备中。
- **悬浮胶囊**：内置便捷的悬浮设置与日志导出按钮，随叫随到，不打扰游戏画面。

载入你的游戏压缩包，让 AetherPlay 为你开启纯粹的冒险之旅。

## 开发

    pnpm install
    pnpm build
    pnpm exec cap sync android
    cd android && ./gradlew assembleDebug

## 致谢与许可 / Acknowledgements & License

AetherPlay 的诞生离不开上游优秀开源项目的支持：

- [local-web-game-player](https://github.com/popupie/local-web-game-player) by popupie — 提供了坚实且极具扩展性的底层 Web 游戏运行环境。

### License

The original [local-web-game-player](https://github.com/popupie/local-web-game-player) is licensed under the **MIT License**.
AetherPlay's own modifications, UI enhancements, and additions are also released under the **MIT License**.

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
