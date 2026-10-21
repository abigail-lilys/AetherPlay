import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { playUrl } from "@/src/lib/playerUrls";
import { logDiagnostic } from "@/src/lib/diagnostics";
import type { GameRecord } from "@/src/lib/types";
import { Icon } from "@/src/components/Icon";
import { TextLogPanel } from "@/src/components/TextLogPanel";
import { GameDebugPanel } from "@/src/components/GameDebugPanel";
import { setAndroidScreenOrientation, type GameScreenOrientation } from "@/src/lib/androidOrientation";
import { setAndroidImmersive } from "@/src/lib/androidImmersive";

const githubUrl = "https://github.com/popupie/mv-mz-browser-player";
const SCREEN_ORIENTATION_KEY = "local-web-game-player-screen-orientation-v1";

function readScreenOrientation(): GameScreenOrientation {
  try {
    const stored = localStorage.getItem("local-web-game-player-screen-orientation-v1");
    return stored === "portrait" || stored === "system" ? stored : "landscape";
  } catch {
    return "landscape";
  }
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
  const [debugOpen, setDebugOpen] = useState(false);
  const [screenOrientation, setScreenOrientation] = useState<GameScreenOrientation>(readScreenOrientation);

  useEffect(() => {
    if (activeGame) {
      try {
        localStorage.setItem(SCREEN_ORIENTATION_KEY, screenOrientation);
      } catch {
        // Storage can be unavailable.
      }
    }
    const targetOrientation: GameScreenOrientation = activeGame ? screenOrientation : "system";
    void setAndroidScreenOrientation(targetOrientation).catch((cause) => {
      logDiagnostic("error", "screen-orientation.change.failed", {
        orientation: targetOrientation,
        activeGame: Boolean(activeGame),
        error: cause instanceof Error ? cause.message : String(cause),
      });
    });
  }, [screenOrientation, Boolean(activeGame)]);

  useEffect(() => {
    if (!activeGame) return;
    void setAndroidImmersive(true).catch((cause) => {
      logDiagnostic("error", "immersive.enter.failed", {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    });
    const playerPanelContent = () => {
      void setAndroidImmersive(false).catch(() => undefined);
    };
  }, [Boolean(activeGame)]);

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
                aria-label="切换沉浸模式"
                title="切换沉浸模式"
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
                  <button type="button" aria-pressed={screenOrientation === "system"} onClick={() => setScreenOrientation("system")}>跟随系统</button>
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
                  aria-label="Dismiss error"
                  title="Dismiss error"
                  onClick={resetRuntimeError}
                >
                  <Icon name="x" />
                </button>
              </div>
            )}
            <div className="player-stage">
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
  return (
    <>
      {playerPanelContent}
      {activeGame ? (
        <>
          <button
            type="button"
            aria-label="打开游戏调试台"
            title={`调试：${activeGame.title}`}
            onClick={() => setDebugOpen((open) => !open)}
            style={{
              position: "fixed",
              right: "14px",
              bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
              zIndex: 99990,
              border: "1px solid #6aa8ef",
              borderRadius: 999,
              padding: "10px 15px",
              background: "#1d4f85",
              color: "#fff",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: "0.04em",
              boxShadow: "0 4px 18px rgba(0,0,0,.35)",
            }}
          >
            DEBUG
          </button>
          {debugOpen ? (
            <GameDebugPanel
              gameId={activeGame.id}
              gameTitle={activeGame.title}
              frameRef={frameRef}
              onClose={() => setDebugOpen(false)}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}
