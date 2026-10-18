import {
  useEffect,
  useState,
  type ChangeEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { formatBytes } from "@/src/lib/format";
import {
  setAndroidScreenOrientation,
  type GameScreenOrientation,
} from "@/src/lib/androidOrientation";
import {
  readScreenOrientationPref,
  writeScreenOrientationPref,
} from "@/src/lib/screenOrientationPref";
import type { GameRecord, ImportProgress } from "@/src/lib/types";

const GITHUB_README =
  "https://github.com/popupie/mv-mz-browser-player#extracting-packaged-desktop-games";

type View = "library" | "settings" | "help";
type IconName =
  | "plus"
  | "zip"
  | "settings"
  | "help"
  | "more"
  | "back"
  | "trash"
  | "download"
  | "x";

const ICON_PATHS: Record<IconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  zip: (
    <>
      <rect x="3" y="4" width="18" height="5" rx="1" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h7M15 18h5" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="13" cy="18" r="2" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" />
    </>
  ),
  more: (
    <>
      <circle cx="12" cy="5" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  trash: (
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  ),
  download: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
};

function GlyphIcon({ name }: { name: IconName }) {
  return (
    <svg
      className="lib2-icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

function sourceLabel(game: GameRecord, bound: boolean): string {
  switch (game.sourceKind) {
    case "local-folder":
      return "已关联文件夹";
    case "android-folder":
      return "已关联手机文件夹";
    case "session-folder":
      return bound ? "已绑定" : "需重新选择文件夹";
    default:
      return formatBytes(game.totalBytes);
  }
}

function coverStyle(title: string) {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  const hue = hash % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue} 52% 40%), hsl(${(hue + 45) % 360} 58% 26%))`,
  };
}

function coverLetter(title: string): string {
  const first = Array.from(title.trim())[0];
  return first ? first.toUpperCase() : "?";
}

interface GameSheetProps {
  game: GameRecord;
  onClose: () => void;
  onDelete: (game: GameRecord) => void;
  onDownload: (game: GameRecord) => void;
}

function GameSheet({ game, onClose, onDelete, onDownload }: GameSheetProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="lib2-sheet-backdrop" onClick={onClose}>
      <div
        className="lib2-sheet"
        role="dialog"
        aria-label={game.title}
        onClick={(event) => event.stopPropagation()}
      >
        <strong className="lib2-sheet-title">{game.title}</strong>
        <button
          type="button"
          className="lib2-sheet-action"
          onClick={() => {
            onClose();
            onDownload(game);
          }}
        >
          <GlyphIcon name="download" />
          <span>下载存档</span>
        </button>
        <button
          type="button"
          className="lib2-sheet-action danger"
          onClick={() => {
            if (!confirming) {
              setConfirming(true);
              return;
            }
            onClose();
            onDelete(game);
          }}
        >
          <GlyphIcon name="trash" />
          <span>{confirming ? "再点一次确认删除" : "删除"}</span>
        </button>
        <button type="button" className="lib2-sheet-cancel" onClick={onClose}>
          取消
        </button>
      </div>
    </div>
  );
}

interface HomeScreenProps {
  boundSessionGameIds: Set<string>;
  clearStorage: () => void;
  directoryInputRef: RefObject<HTMLInputElement | null>;
  downloadSaves: (game: GameRecord) => void;
  error: string | null;
  games: GameRecord[];
  importFolder: (event: ChangeEvent<HTMLInputElement>) => void;
  importZip: (event: ChangeEvent<HTMLInputElement>) => void;
  notice: string | null;
  openFolder: () => void;
  progress: ImportProgress;
  quotaPercent: number;
  removeGame: (game: GameRecord) => void;
  bindSessionFolder: (game: GameRecord) => void;
  resetError: () => void;
  resetNotice: () => void;
  selectGame: (gameId: string) => void;
  storage?: StorageEstimate;
  zipInputRef: RefObject<HTMLInputElement | null>;
}

export function HomeScreen({
  boundSessionGameIds,
  clearStorage,
  directoryInputRef,
  downloadSaves,
  error,
  games,
  importFolder,
  importZip,
  notice,
  openFolder,
  progress,
  quotaPercent,
  removeGame,
  bindSessionFolder,
  resetError,
  resetNotice,
  selectGame,
  storage,
  zipInputRef,
}: HomeScreenProps) {
  const [view, setView] = useState<View>("library");
  const [actionGame, setActionGame] = useState<GameRecord | null>(null);
  const [orientation, setOrientation] =
    useState<GameScreenOrientation>(readScreenOrientationPref);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    void setAndroidScreenOrientation("system").catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmClear]);

  const chooseOrientation = (value: GameScreenOrientation) => {
    setOrientation(value);
    writeScreenOrientationPref(value);
  };

  const openGame = (game: GameRecord) => {
    if (
      game.sourceKind === "session-folder" &&
      !boundSessionGameIds.has(game.id)
    ) {
      bindSessionFolder(game);
      return;
    }
    selectGame(game.id);
  };

  const progressPercent =
    progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;
  const storageUsage = storage?.usage ?? 0;
  const storageQuota = storage?.quota ?? 0;
  const storageText = storageQuota
    ? `${formatBytes(storageUsage)} / ${formatBytes(storageQuota)}`
    : formatBytes(storageUsage);
  const title =
    view === "library" ? "游戏库" : view === "settings" ? "设置" : "帮助";

  return (
    <main className="lib2-root">
      <header className="lib2-bar">
        {view !== "library" && (
          <button
            type="button"
            className="lib2-back"
            aria-label="返回游戏库"
            onClick={() => setView("library")}
          >
            <GlyphIcon name="back" />
          </button>
        )}
        <h1>{title}</h1>
        {view === "library" && games.length > 0 && (
          <span className="lib2-count">{games.length}</span>
        )}
      </header>

      <div className="lib2-body">
        {progress.phase !== "idle" && (
          <div className="lib2-progress" aria-live="polite">
            <strong>
              ({progressPercent}%) {progress.label}
            </strong>
            <progress value={progress.completed} max={Math.max(progress.total, 1)} />
          </div>
        )}

        {error && (
          <div className="lib2-alert error">
            <span>{error}</span>
            <button type="button" aria-label="关闭" onClick={resetError}>
              <GlyphIcon name="x" />
            </button>
          </div>
        )}

        {notice && (
          <div className="lib2-alert">
            <span>{notice}</span>
            <button type="button" aria-label="关闭" onClick={resetNotice}>
              <GlyphIcon name="x" />
            </button>
          </div>
        )}

        {view === "library" &&
          (games.length === 0 ? (
            <div className="lib2-empty">
              <strong>还没有游戏</strong>
              <p>
                点击下方「添加游戏」，选择游戏所在的文件夹（里面需要有
                index.html）。
              </p>
            </div>
          ) : (
            <div className="lib2-grid">
              {games.map((game) => (
                <div className="lib2-card" key={game.id}>
                  <button
                    type="button"
                    className="lib2-card-main"
                    onClick={() => openGame(game)}
                  >
                    <span className="lib2-cover" style={coverStyle(game.title)}>
                      {coverLetter(game.title)}
                    </span>
                    <strong className="lib2-card-title">{game.title}</strong>
                    <span className="lib2-card-meta">
                      {game.fileCount} 个文件 ·{" "}
                      {sourceLabel(game, boundSessionGameIds.has(game.id))}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="lib2-card-more"
                    aria-label={`${game.title} 的选项`}
                    onClick={() => setActionGame(game)}
                  >
                    <GlyphIcon name="more" />
                  </button>
                </div>
              ))}
            </div>
          ))}

        {view === "settings" && (
          <div className="lib2-page">
            <section className="lib2-section">
              <h2>屏幕方向</h2>
              <p>进入游戏时使用。游戏内的「设置」里也可以随时切换。</p>
              <div className="lib2-seg">
                <button
                  type="button"
                  aria-pressed={orientation === "landscape"}
                  onClick={() => chooseOrientation("landscape")}
                >
                  横屏（默认）
                </button>
                <button
                  type="button"
                  aria-pressed={orientation === "portrait"}
                  onClick={() => chooseOrientation("portrait")}
                >
                  竖屏
                </button>
                <button
                  type="button"
                  aria-pressed={orientation === "system"}
                  onClick={() => chooseOrientation("system")}
                >
                  跟随系统
                </button>
              </div>
              <p className="lib2-hint">
                「跟随系统」会随手机的自动旋转开关和朝向变化，游戏里的触摸按钮布局也会自动切换。
              </p>
            </section>

            <section className="lib2-section">
              <h2>浏览器存储</h2>
              <div className="lib2-row">
                <span>已用 / 总量</span>
                <strong>{storageText}</strong>
              </div>
              <progress value={quotaPercent} max={100} />
              <button
                type="button"
                className={confirmClear ? "lib2-danger confirming" : "lib2-danger"}
                onClick={() => {
                  if (!confirmClear) {
                    setConfirmClear(true);
                    return;
                  }
                  setConfirmClear(false);
                  clearStorage();
                }}
              >
                <GlyphIcon name="trash" />
                <span>{confirmClear ? "再点一次确认清除" : "清除浏览器存储"}</span>
              </button>
            </section>
          </div>
        )}

        {view === "help" && (
          <div className="lib2-page">
            <section className="lib2-section">
              <h2>如何使用</h2>
              <p>
                先添加游戏，再在游戏库里点击游戏即可运行。游戏文件夹（或 ZIP）里需要有{" "}
                <code>index.html</code>。
              </p>
              <p>
                支持 RPG Maker MV/MZ、Wolf RPG（网页版导出）、TyranoScript、已解压的
                Construct 2/NW.js，以及 Cocos Creator/Electron 导出的游戏。
              </p>
            </section>
            <section className="lib2-section">
              <h2>添加游戏</h2>
              <p>直接使用手机上的游戏文件夹，不会占用浏览器存储。</p>
            </section>
            <section className="lib2-section">
              <h2>导入 ZIP</h2>
              <p>把游戏复制进浏览器存储，更适合体积较小的游戏。</p>
            </section>
            <section className="lib2-section">
              <h2>游戏打包在压缩包或程序里？</h2>
              <p>
                请先按{" "}
                <a href={GITHUB_README} target="_blank" rel="noreferrer">
                  GitHub README
                </a>{" "}
                里的说明解出游戏文件。
              </p>
            </section>
          </div>
        )}
      </div>

      <input
        ref={directoryInputRef}
        className="lib2-hidden hidden-input"
        type="file"
        multiple
        onChange={importFolder}
        {...{ webkitdirectory: "" }}
      />
      <input
        ref={zipInputRef}
        className="lib2-hidden hidden-input"
        type="file"
        accept=".zip,application/zip"
        onChange={importZip}
      />

      <nav className="lib2-nav" aria-label="主导航">
        <button
          type="button"
          onClick={() => {
            setView("library");
            openFolder();
          }}
        >
          <GlyphIcon name="plus" />
          <span>添加游戏</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setView("library");
            zipInputRef.current?.click();
          }}
        >
          <GlyphIcon name="zip" />
          <span>导入 ZIP</span>
        </button>
        <button
          type="button"
          className={view === "settings" ? "active" : ""}
          onClick={() => setView(view === "settings" ? "library" : "settings")}
        >
          <GlyphIcon name="settings" />
          <span>设置</span>
        </button>
        <button
          type="button"
          className={view === "help" ? "active" : ""}
          onClick={() => setView(view === "help" ? "library" : "help")}
        >
          <GlyphIcon name="help" />
          <span>帮助</span>
        </button>
      </nav>

      {actionGame && (
        <GameSheet
          key={actionGame.id}
          game={actionGame}
          onClose={() => setActionGame(null)}
          onDelete={removeGame}
          onDownload={downloadSaves}
        />
      )}
    </main>
  );
}
