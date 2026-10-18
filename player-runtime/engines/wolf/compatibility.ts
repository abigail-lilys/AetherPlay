import { exactModifierMatch } from "@/shared/keyInput";

export type WolfPlayerSettings = {
  reservedKeys?: Array<{
    code: string;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    action: string;
  }>;
};

type WolfCompatibilityOptions = {
  gameId: string;
  initialSettings?: WolfPlayerSettings;
  getCanvas: () => HTMLCanvasElement | null;
};

type WolfParentMessage = {
  type?: string;
  settings?: WolfPlayerSettings;
};

function normalizeSettings(next: WolfPlayerSettings | undefined) {
  return {
    reservedKeys: Array.isArray(next?.reservedKeys) ? next.reservedKeys : [],
  };
}

export function installWolfCompatibility(options: WolfCompatibilityOptions) {
  let settings = normalizeSettings(options.initialSettings);
  let viewportCandidate = "";
  let viewportCandidateSamples = 0;
  let lastReportedViewport = "";
  let lastCanvasLayout = "";

  // Browser Woditor normally owns its page layout. Inside our already-sized
  // iframe that creates a second layout system, so let the parent own the
  // viewport and keep only the game canvas visible.
  document.documentElement.classList.add("mz-player-browser-woditor");
  const style = document.createElement("style");
  style.id = "mz-player-wolf-compatibility";
  style.textContent = `
    canvas:focus,
    canvas:focus-visible {
      outline: none !important;
    }

    html.mz-player-browser-woditor,
    html.mz-player-browser-woditor body,
    html.mz-player-browser-woditor #outer,
    html.mz-player-browser-woditor #container,
    html.mz-player-browser-woditor #screen-holder-main,
    html.mz-player-browser-woditor #main,
    html.mz-player-browser-woditor #screen,
    html.mz-player-browser-woditor #main-content {
      box-sizing: border-box !important;
      width: 100% !important;
      height: 100% !important;
      min-width: 0 !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
    }

    html.mz-player-browser-woditor #outer,
    html.mz-player-browser-woditor #container,
    html.mz-player-browser-woditor #main,
    html.mz-player-browser-woditor #screen,
    html.mz-player-browser-woditor #main-content {
      display: block !important;
    }

    html.mz-player-browser-woditor #screen-holder-left,
    html.mz-player-browser-woditor #screen-holder-right,
    html.mz-player-browser-woditor #main-header,
    html.mz-player-browser-woditor #main-footer {
      display: none !important;
    }

    html.mz-player-browser-woditor.mz-player-wolf-sides #container {
      display: grid !important;
      grid-template-columns: var(--mz-player-wolf-side-width, 0px) minmax(0, 1fr) var(--mz-player-wolf-side-width, 0px) !important;
      grid-template-rows: minmax(0, 1fr) !important;
    }

    html.mz-player-browser-woditor.mz-player-wolf-sides #screen-holder-left,
    html.mz-player-browser-woditor.mz-player-wolf-sides #screen-holder-right {
      display: flex !important;
      box-sizing: border-box !important;
      width: 100% !important;
      height: 100% !important;
      min-width: 0 !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 2px !important;
      overflow: hidden !important;
    }

    html.mz-player-browser-woditor.mz-player-wolf-sides #screen-holder-left {
      grid-column: 1 !important;
      order: 1 !important;
    }

    html.mz-player-browser-woditor.mz-player-wolf-sides #screen-holder-main {
      grid-column: 2 !important;
      order: 2 !important;
    }

    html.mz-player-browser-woditor.mz-player-wolf-sides #screen-holder-right {
      grid-column: 3 !important;
      order: 3 !important;
    }

    html.mz-player-browser-woditor.mz-player-wolf-bottom #container {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
      grid-template-rows: minmax(0, 1fr) var(--mz-player-wolf-bottom-height, 0px) !important;
    }

    html.mz-player-browser-woditor.mz-player-wolf-bottom #screen-holder-main {
      grid-column: 1 / span 2 !important;
      grid-row: 1 !important;
    }

    html.mz-player-browser-woditor.mz-player-wolf-bottom #screen-holder-left,
    html.mz-player-browser-woditor.mz-player-wolf-bottom #screen-holder-right {
      display: flex !important;
      box-sizing: border-box !important;
      width: 100% !important;
      height: 100% !important;
      min-width: 0 !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 2px !important;
      overflow: hidden !important;
      grid-row: 2 !important;
    }

    html.mz-player-browser-woditor.mz-player-wolf-bottom #screen-holder-left {
      grid-column: 1 !important;
    }

    html.mz-player-browser-woditor.mz-player-wolf-bottom #screen-holder-right {
      grid-column: 2 !important;
    }

    html.mz-player-browser-woditor #main {
      position: relative !important;
      top: 0 !important;
    }

    html.mz-player-browser-woditor #main-content {
      position: absolute !important;
      inset: 0 !important;
    }

    html.mz-player-browser-woditor #canvas {
      position: absolute !important;
      inset: auto !important;
      left: 50% !important;
      top: 50% !important;
      width: var(--mz-player-wolf-canvas-width, 100%) !important;
      height: var(--mz-player-wolf-canvas-height, 100%) !important;
      max-width: 100% !important;
      max-height: 100% !important;
      margin: 0 !important;
      translate: -50% -50% !important;
      transform: none !important;
    }
  `;
  document.documentElement.appendChild(style);

  // Touch side panels: the game's own HOLD/DRAG/Sub/Cancel/Enter UI lives in
  // #screen-holder-left/right. Reserve space for them only when the game wants
  // them and the viewport is landscape; otherwise keep the canvas-only layout.
  function readWolfGameSettings(): { hideSideButtons?: boolean } | null {
    try {
      return (0, eval)(
        "typeof WoditorGameSettings === 'undefined' ? null : WoditorGameSettings",
      ) as { hideSideButtons?: boolean } | null;
    } catch {
      return null;
    }
  }

  const WOLF_SIDE_MIN = 96;
  const WOLF_SIDE_MAX = 240;
  const WOLF_BOTTOM_MIN = 140; // CSS px needed below the canvas for the portrait panels

  type WolfSideLayout = { mode: "none" | "sides" | "bottom"; side: number; bottom: number };
  const WOLF_NO_PANELS: WolfSideLayout = { mode: "none", side: 0, bottom: 0 };

  function wolfSideLayout(
    canvas: HTMLCanvasElement,
    fullWidth: number,
    fullHeight: number,
  ): WolfSideLayout {
    if (readWolfGameSettings()?.hideSideButtons) return WOLF_NO_PANELS;
    if (!document.getElementById("screen-holder-left")) return WOLF_NO_PANELS;
    if (!document.getElementById("screen-holder-right")) return WOLF_NO_PANELS;
    if (fullWidth / fullHeight < 3.5 / 4) {
      // Portrait: canvas on top at full width, the two panels side by side below it.
      const canvasHeight = fullWidth * (canvas.height / canvas.width);
      const bottom = fullHeight - canvasHeight;
      return bottom >= WOLF_BOTTOM_MIN
        ? { mode: "bottom", side: 0, bottom: Math.floor(bottom) }
        : WOLF_NO_PANELS;
    }
    const free = (fullWidth - canvas.width * (fullHeight / canvas.height)) / 2;
    const side = Math.min(WOLF_SIDE_MAX, Math.max(WOLF_SIDE_MIN, free));
    return side * 2 > fullWidth * 0.6
      ? WOLF_NO_PANELS
      : { mode: "sides", side: Math.round(side), bottom: 0 };
  }

  function applyWolfLayout(layout: WolfSideLayout) {
    const rootElement = document.documentElement;
    rootElement.classList.toggle("mz-player-wolf-sides", layout.mode === "sides");
    rootElement.classList.toggle("mz-player-wolf-bottom", layout.mode === "bottom");
    rootElement.style.setProperty("--mz-player-wolf-side-width", `${layout.side}px`);
    rootElement.style.setProperty("--mz-player-wolf-bottom-height", `${layout.bottom}px`);
  }

  function postParent(message: object) {
    window.parent.postMessage(message, window.location.origin);
  }

  const LOG_EXPORT_BUTTON_ID = "mz-player-log-export";

  function createLogExportButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.id = LOG_EXPORT_BUTTON_ID;
    button.type = "button";
    button.textContent = "log";
    button.setAttribute("aria-label", "log");
    button.title = "Export diagnostic log";
    button.style.cssText = [
      "appearance:none!important",
      "-webkit-appearance:none!important",
      "position:fixed!important",
      // 假设设置按钮在 25px 左右，这里向下加 50px 即为 75px
      "top:calc(env(safe-area-inset-top, 0px) + 75px)!important",
      "right:12px!important",
      "z-index:2147483647!important",
      "display:inline-flex!important",
      "align-items:center!important",
      "justify-content:center!important",
      // 胶囊样式，模拟“设置”按钮的外观
      "width:auto!important",
      "min-width:48px!important",
      "height:32px!important",
      "padding:0 12px!important",
      "border-radius:16px!important",
      "background:rgba(0, 0, 0, 0.4)!important", // 深色半透明，方便看清
      "color:white!important",
      "font-size:13px!important",
      "border:none!important",
      "box-shadow:0 2px 4px rgba(0,0,0,0.2)!important",
      "cursor:pointer!important",
      "touch-action:manipulation!important"
    ].join(";");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      postParent({ type: "export-diagnostics" });
    });
    return button;
  }

  function ensureLogExportButton() {
    // 直接挂载到 body，不依赖任何原生 DOM 结构
    let button = document.getElementById(LOG_EXPORT_BUTTON_ID);
    if (!(button instanceof HTMLButtonElement)) {
      button = createLogExportButton();
      document.body.appendChild(button);
    }
    
    // 强制覆盖样式：固定在屏幕右上角，位于设置按钮下方 30px
    // 设置按钮 top 是 +25px，这里为了对齐加 30px，即 +55px
    button.style.cssText = [
      "appearance:none!important",
      "-webkit-appearance:none!important",
      "position:fixed!important",
      "top:calc(env(safe-area-inset-top, 0px) + 100px)!important",
      "right:calc(env(safe-area-inset-right, 0px) + 12px)!important",
      "z-index:2147483647!important",
      "display:inline-flex!important",
      "align-items:center!important",
      "justify-content:center!important",
      "width:36px!important",
      "height:36px!important",
      "border-radius:50%!important",
      "background:rgba(0, 0, 0, 0.3)!important", // 半透明黑底方便测试找
      "color:white!important",
      "font-size:12px!important",
      "border:none!important",
      "cursor:pointer!important",
      "touch-action:manipulation!important"
    ].join(";");
  }

  function syncCanvasViewport(canvas: HTMLCanvasElement) {
    if (canvas.width <= 0 || canvas.height <= 0) return;
    const fullWidth = document.documentElement.clientWidth || window.innerWidth;
    const fullHeight = document.documentElement.clientHeight || window.innerHeight;
    if (fullWidth <= 0 || fullHeight <= 0) return;
    const layout = wolfSideLayout(canvas, fullWidth, fullHeight);
    applyWolfLayout(layout);
    const viewportWidth = fullWidth - layout.side * 2;
    const viewportHeight = fullHeight - layout.bottom;
    if (viewportWidth <= 0 || viewportHeight <= 0) return;
    const scale = Math.min(viewportWidth / canvas.width, viewportHeight / canvas.height);
    const cssWidth = canvas.width * scale;
    const cssHeight = canvas.height * scale;
    const layoutKey = `${canvas.width}x${canvas.height}:${viewportWidth}x${viewportHeight}`;
    if (layoutKey !== lastCanvasLayout) {
      lastCanvasLayout = layoutKey;
      document.documentElement.style.setProperty(
        "--mz-player-wolf-canvas-width",
        `${cssWidth}px`,
      );
      document.documentElement.style.setProperty(
        "--mz-player-wolf-canvas-height",
        `${cssHeight}px`,
      );
    }

    const viewportKey = `${canvas.width}x${canvas.height}`;
    if (viewportKey === lastReportedViewport) return;
    if (viewportKey !== viewportCandidate) {
      viewportCandidate = viewportKey;
      viewportCandidateSamples = 1;
      return;
    }
    viewportCandidateSamples += 1;
    if (viewportCandidateSamples < 2) return;
    lastReportedViewport = viewportKey;
    postParent({ type: "game-viewport", width: canvas.width, height: canvas.height });
  }

  function syncLayout() {
    const canvas = options.getCanvas();
    if (canvas) syncCanvasViewport(canvas);
    ensureLogExportButton();
  }

  function focusGame() {
    const canvas = options.getCanvas();
    const target = canvas ?? document.body ?? document.documentElement;
    try {
      window.focus();
      if (target instanceof HTMLElement && !target.hasAttribute("tabindex")) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    } catch {
      // Browser focus is best effort.
    }
  }

  function handleParentMessage(event: MessageEvent<WolfParentMessage>) {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "focus-game") {
      focusGame();
      return;
    }
    if (message.type === "player-settings") settings = normalizeSettings(message.settings);
  }

  function handleReservedKey(event: KeyboardEvent) {
    if (event.type !== "keydown") return;
    const key = settings.reservedKeys.find(
      (item) => item.code === event.code && exactModifierMatch(event, item),
    );
    if (!key || key.action === "toggleOverlay" || key.action === "toggleReader") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    postParent({ type: "reserved-key", action: key.action, code: event.code });
  }

  for (const type of ["keydown", "keypress", "keyup"] as const) {
    window.addEventListener(type, handleReservedKey, true);
  }
  window.addEventListener("message", handleParentMessage);
  window.addEventListener("resize", syncLayout);
  window.setInterval(syncLayout, 250);
  syncLayout();
  postParent({
    type: "overlay-availability",
    gameId: options.gameId,
    available: false,
  });
}
