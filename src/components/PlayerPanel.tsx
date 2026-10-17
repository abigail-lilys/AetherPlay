import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { playUrl } from "@/src/lib/playerUrls";
import { exportDiagnosticsTxt, logDiagnostic } from "@/src/lib/diagnostics";
import type { GameRecord } from "@/src/lib/types";
import { Icon } from "@/src/components/Icon";
import { TextLogPanel } from "@/src/components/TextLogPanel";
import { setAndroidScreenOrientation, type GameScreenOrientation } from "@/src/lib/androidOrientation";

const githubUrl = "https://github.com/popupie/mv-mz-browser-player";
const SCREEN_ORIENTATION_KEY = "local-web-game-player-screen-orientation-v1";

type VirtualKeyCode = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Enter" | "Escape" | "Shift";
const VIRTUAL_KEY_DETAILS: Record<VirtualKeyCode, { key: string; code: string }> = {
  ArrowUp: { key: "ArrowUp", code: "ArrowUp" },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown" },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft" },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight" },
  Enter: { key: "Enter", code: "Enter" },
  Escape: { key: "Escape", code: "Escape" },
  Shift: { key: "Shift", code: "ShiftLeft" },
};

function readScreenOrientation(): GameScreenOrientation {
  try {
    return localStorage.getItem(SCREEN_ORIENTATION_KEY) === "portrait" ? "portrait" : "landscape";
  } catch {
    return "landscape";
  }
}

function dispatchVirtualKey(
  frameRef: RefObject<HTMLIFrameElement | null>,
  code: VirtualKeyCode,
  pressed: boolean,
): void {
  const frameWindow = frameRef.current?.contentWindow as (Window & typeof globalThis) | null | undefined;
  if (!frameWindow) return;
  try {
    const target = frameWindow.document.querySelector("canvas, #canvas")
      ?? frameWindow.document.activeElement
      ?? frameWindow.document.body;
    if (!target) return;
    const detail = VIRTUAL_KEY_DETAILS[code];
    const event = new frameWindow.KeyboardEvent(pressed ? "keydown" : "keyup", {
      key: detail.key,
      code: detail.code,
      bubbles: true,
      cancelable: true,
      repeat: false,
    });
    target.dispatchEvent(event);
    if (pressed) frameWindow.focus();
  } catch (cause) {
    logDiagnostic("warn", "virtual-control.dispatch.failed", {
      code,
      pressed,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

interface VirtualKeyButtonProps {
  label: string;
  code: VirtualKeyCode;
  frameRef: RefObject<HTMLIFrameElement | null>;
}

function VirtualKeyButton({ label, code, frameRef }: VirtualKeyButtonProps) {
  const onDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer capture is optional */ }
    dispatchVirtualKey(frameRef, code, true);
  };
  const onUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dispatchVirtualKey(frameRef, code, false);
  };
  return (
    <button
      type="button"
      className="virtual-key-button"
      aria-label={label}
      title={label}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {label}
    </button>
  );
}

interface PlayerPanelProps {
  onReturnHome: () => void;
  activeGame?: GameRecord;
  focusPlayer: () => void;
  frameRef: RefObject<HTMLIFrameElement | null>;
  frameWrapRef: RefObject<HTMLDivElement | null>;
  gameAspectRatio: number;
  logsOpen: boolean;
  overlayAvailable: boolean;
  onIframeLoad: () => void;
  onRequestFullscreen: () => void;
  onToggleOverlay: (game: GameRecord) => void;
  onToggleShow: (game: GameRecord) => void;
  resetRuntimeError: () => void;
  runtimeError: string | null;
  setLogsOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  textLogLimit: number;
  textLogs: string[];
}

export function PlayerPanel({
  activeGame,
  focusPlayer,
  frameRef,
  frameWrapRef,
  gameAspectRatio,
  logsOpen,
  overlayAvailable,
  onIframeLoad,
  onRequestFullscreen,
  onReturnHome,
  onToggleOverlay,
  onToggleShow,
  resetRuntimeError,
  runtimeError,
  setLogsOpen,
  textLogLimit,
  textLogs,
}: PlayerPanelProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [screenOrientation, setScreenOrientation] = useState<GameScreenOrientation>(readScreenOrientation);

  useEffect(() => {
    try { localStorage.setItem(SCREEN_ORIENTATION_KEY, screenOrientation); } catch { /* storage can be unavailable */ }
    void setAndroidScreenOrientation(screenOrientation).catch((cause) => {
      logDiagnostic("error", "screen-orientation.change.failed", {
        orientation: screenOrientation,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    });
  }, [screenOrientation]);

  return (
    <section
      className={`player-panel${activeGame ? "" : " home-player-panel"}`}
      aria-label="Player"
    >
      {!activeGame && (
        <div className="home-guide">
          <section className="home-guide-intro" aria-labelledby="home-title">
            <h2 id="home-title">How to use this player</h2>
            <p>
              Open a local RPG Maker MV/MZ, Wolf RPG, TyranoScript, extracted
              Construct 2/NW.js, or Cocos Creator/Electron export, then select
              it from the library. The folder or ZIP needs a game{" "}
              <code>index.html</code>.
            </p>
            <p>
              If the game files are packed inside an archive or executable, see
              the extraction instructions in the{" "}
              <a
                href={`${githubUrl}#extracting-packaged-desktop-games`}
                target="_blank"
                rel="noreferrer"
              >
                GitHub README
              </a>
              .
            </p>
          </section>

          <div className="home-action-grid" aria-label="Import choices">
            <article className="home-instruction-card">
              <span className="home-control-preview" aria-hidden="true">
                <Icon name="folder" />
              </span>
              <div>
                <h3>Open folder</h3>
                <p>
                  Uses files from your disk. Folder size does not count toward
                  browser storage.
                </p>
              </div>
            </article>

            <article className="home-instruction-card">
              <span className="home-control-preview" aria-hidden="true">
                <Icon name="archive" />
              </span>
              <div>
                <h3>Import ZIP</h3>
                <p>
                  Copies the game into browser storage. Better for smaller
                  games.
                </p>
              </div>
            </article>
          </div>

          <div className="home-secondary-grid">
            <section
              className="home-guide-section home-controls-section"
              aria-label="Button guide"
            >
              <div className="home-controls-grid">
                <h3>Library buttons</h3>
                <h3>Player buttons</h3>

                <div className="home-control-cell">
                  <Icon name="download" />
                  <span>
                    Download saves when you want a backup outside the browser.
                  </span>
                </div>
                <div className="home-control-cell">
                  <Icon name="layers" />
                  <span>
                    Overlay captures text or sprite-font dialogue for selection
                    and the text log.
                  </span>
                </div>

                <div className="home-control-cell">
                  <Icon name="trash" />
                  <span>
                    Delete removes library entry and its browser-stored data.
                  </span>
                </div>
                <div className="home-control-cell">
                  <Icon name="eye" />
                  <span>
                    Show makes overlay text visible on top of the game.
                  </span>
                </div>

                <div className="home-control-cell">
                  <Icon name="home" />
                  <span>Home returns to this page.</span>
                </div>
                <div className="home-control-cell">
                  <Icon name="focus" />
                  <span>Focus sends keyboard input back to the game.</span>
                </div>

                <div className="home-control-cell">
                  <Icon name="shield" />
                  <span>
                    Guard blocks added keys from reaching the game while the
                    overlay is active.
                  </span>
                </div>
                <div className="home-control-cell">
                  <Icon name="fullscreen" />
                  <span>Fullscreen expands the play view.</span>
                </div>
              </div>
            </section>
          </div>

          <section
            className="home-guide-section home-guide-note"
            aria-label="Folder warning and privacy"
          >
            <p>
              When opening a folder, the browser may warn that all files from
              that folder will be uploaded. That is the normal folder picker
              warning. This app reads the files locally, and nothing is uploaded
              or stored on a server. Source is on{" "}
              <a href={githubUrl} target="_blank" rel="noreferrer">
                GitHub
              </a>
              .
            </p>
          </section>
        </div>
      )}

      {activeGame && (
        <>
          <div className="player-toolbar">
            <div>
              <h2>{activeGame.title}</h2>
              <p>{activeGame.entryPath}</p>
            </div>
            <div className="tool-buttons">
              <button type="button" className="mobile-library-button" onClick={onReturnHome}>
                游戏库
              </button>
              <button
                type="button"
                aria-label="Open text overlay"
                title={
                  overlayAvailable
                    ? "Open text overlay"
                    : "Text overlay unavailable for this game"
                }
                aria-pressed={
                  overlayAvailable && activeGame.settings.overlayEnabled
                }
                disabled={!overlayAvailable}
                onClick={() => onToggleOverlay(activeGame)}
              >
                <Icon name="layers" />
              </button>
              {overlayAvailable && activeGame.settings.overlayEnabled && (
                <button
                  type="button"
                  className="show-mode-button"
                  aria-label="Show overlay text"
                  title="Show overlay text"
                  aria-pressed={Boolean(activeGame.settings.readableOverlay)}
                  onClick={() => onToggleShow(activeGame)}
                >
                  <Icon name="eye" />
                </button>
              )}
              <button
                type="button"
                aria-label="Focus game"
                title="Focus game"
                onClick={focusPlayer}
              >
                <Icon name="focus" />
              </button>
              <button
                type="button"
                aria-label="Fullscreen"
                title="Fullscreen"
                onClick={onRequestFullscreen}
              >
                <Icon name="fullscreen" />
              </button>
              <button
                type="button"
                className="game-settings-button"
                aria-label="游戏设置"
                aria-expanded={settingsOpen}
                title="游戏设置"
                onClick={() => setSettingsOpen((open) => !open)}
              >
                设置
              </button>
            </div>
            {settingsOpen && (
              <div className="game-settings-menu" role="dialog" aria-label="游戏设置">
                <strong>屏幕方向</strong>
                <div className="orientation-options">
                  <button type="button" aria-pressed={screenOrientation === "landscape"} onClick={() => setScreenOrientation("landscape")}>横屏（默认）</button>
                  <button type="button" aria-pressed={screenOrientation === "portrait"} onClick={() => setScreenOrientation("portrait")}>竖屏</button>
                </div>
                <button
                  type="button"
                  className="exit-game-button"
                  onClick={() => { setSettingsOpen(false); onReturnHome(); }}
                >
                  退出游戏（返回游戏库）
                </button>
              </div>
            )}
          </div>
          <div className="player-scroll">
            {runtimeError && (
              <div className="runtime-error dismissible-alert">
                <span>{runtimeError}</span>
                <button
                  type="button"
                  className="diagnostic-export-button"
                  onClick={() => {
                    void exportDiagnosticsTxt().then(
                      () => window.alert("诊断日志 TXT 已保存。"),
                      (cause) => {
                        logDiagnostic("error", "diagnostics.export.failed", { error: cause instanceof Error ? cause.message : String(cause) });
                        window.alert(`导出日志失败：${cause instanceof Error ? cause.message : String(cause)}`);
                      },
                    );
                  }}
                >
                  导出诊断日志 TXT
                </button>

                <button
                  type="button"
                  aria-label="Dismiss error"
                  title="Dismiss error"
                  onClick={resetRuntimeError}
                >
                  <Icon name="x" />
                </button>
              </div>
            )}
            <div className="player-stage">
              <div className="virtual-control-panel virtual-control-left" aria-label="方向控制">
                <span className="virtual-key-spacer" aria-hidden="true" />
                <VirtualKeyButton label="▲" code="ArrowUp" frameRef={frameRef} />
                <span className="virtual-key-spacer" aria-hidden="true" />
                <VirtualKeyButton label="◀" code="ArrowLeft" frameRef={frameRef} />
                <span className="virtual-key-spacer virtual-key-center" aria-hidden="true">●</span>
                <VirtualKeyButton label="▶" code="ArrowRight" frameRef={frameRef} />
                <span className="virtual-key-spacer" aria-hidden="true" />
                <VirtualKeyButton label="▼" code="ArrowDown" frameRef={frameRef} />
                <span className="virtual-key-spacer" aria-hidden="true" />
              </div>
              <div
                ref={frameWrapRef}
                className="frame-wrap"
                style={
                  {
                    "--game-aspect-ratio": String(gameAspectRatio),
                  } as CSSProperties
                }
              >
                <iframe
                  key={`${activeGame.id}:${activeGame.entryPath}`}
                  ref={frameRef}
                  title={activeGame.title}
                  src={playUrl(activeGame)}
                  allow="fullscreen; autoplay"
                  tabIndex={-1}
                  onLoad={onIframeLoad}
                />
              </div>
              <div className="virtual-control-panel virtual-control-right" aria-label="游戏功能键">
                <VirtualKeyButton label="Sub" code="Shift" frameRef={frameRef} />
                <VirtualKeyButton label="Cancel" code="Escape" frameRef={frameRef} />
                <VirtualKeyButton label="↵" code="Enter" frameRef={frameRef} />
              </div>
            </div>
            {overlayAvailable && (
              <TextLogPanel
                logsOpen={logsOpen}
                setLogsOpen={setLogsOpen}
                textLogLimit={textLogLimit}
                textLogs={textLogs}
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}
