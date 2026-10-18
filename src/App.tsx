import { Capacitor } from "@capacitor/core";
import { useRef } from "react";
import { HomeScreen } from "@/src/components/HomeScreen";
import { LibraryPanel } from "@/src/components/LibraryPanel";
import { PlayerPanel } from "@/src/components/PlayerPanel";
import { usePlayerController } from "@/src/hooks/usePlayerController";
import { overlayTogglePatch, showTogglePatch } from "@/src/lib/playerSettings";

export default function App() {
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const controller = usePlayerController();
  const { library, player } = controller;

  if (!library.activeGame) {
    return (
      <HomeScreen
        boundSessionGameIds={library.boundSessionGameIds}
        clearStorage={() => void library.clearStorage()}
        directoryInputRef={directoryInputRef}
        downloadSaves={(game) => void library.downloadSaves(game)}
        error={library.error}
        games={library.games}
        importFolder={library.importFolder}
        importZip={library.importZip}
        notice={library.notice}
        openFolder={() => {
          if (Capacitor.getPlatform() === "android") {
            void library.openLocalFolder();
            return;
          }
          if (library.canUseLocalFolderAccess) {
            void library.openLocalFolder();
            return;
          }
          directoryInputRef.current?.click();
        }}
        progress={library.progress}
        quotaPercent={controller.quotaPercent}
        removeGame={(game) => void library.removeGame(game)}
        bindSessionFolder={(game) => void library.bindSessionFolder(game)}
        resetError={() => library.setError(null)}
        resetNotice={() => library.setNotice(null)}
        selectGame={(gameId) => void controller.selectGame(gameId)}
        storage={library.storage}
        zipInputRef={zipInputRef}
      />
    );
  }

  return (
    <main className={`app-shell${Capacitor.getPlatform() === "android" ? " android-app" : ""}${library.activeGame ? " has-active-game" : ""}`} onKeyDown={controller.onAppKeyDown}>
      <LibraryPanel
        activeGame={library.activeGame}
        activeGuard={controller.activeDictionaryGuard}
        boundSessionGameIds={library.boundSessionGameIds}
        directoryInputRef={directoryInputRef}
        error={library.error}
        games={library.games}
        guardAvailable={controller.overlayAvailable}
        notice={library.notice}
        clearStorage={() => void library.clearStorage()}
        downloadSaves={(game) => void library.downloadSaves(game)}
        openFolder={() => {
          if (Capacitor.getPlatform() === "android") {
            void library.openLocalFolder();
            return;
          }
          if (library.canUseLocalFolderAccess) {
            void library.openLocalFolder();
            return;
          }
          directoryInputRef.current?.click();
        }}
        importFolder={library.importFolder}
        importZip={library.importZip}
        progress={library.progress}
        quotaPercent={controller.quotaPercent}
        recordingGuardTrigger={controller.recordingGuardTrigger}
        removeGame={(game) => void library.removeGame(game)}
        bindSessionFolder={(game) => void library.bindSessionFolder(game)}
        removeGuardTrigger={(game, index) =>
          void controller.removeGuardTrigger(game, index)
        }
        recordGuardTrigger={(game, event) =>
          void controller.recordGuardTrigger(game, event)
        }
        resetError={() => library.setError(null)}
        resetNotice={() => library.setNotice(null)}
        setActiveGameId={(gameId) => void controller.selectGame(gameId)}
        setIdle={() => void controller.returnHome()}
        setDictionaryGuard={(game, guard) =>
          void controller.setDictionaryGuard(game, guard)
        }
        setRecordingGuardTrigger={controller.setRecordingGuardTrigger}
        storage={library.storage}
        zipInputRef={zipInputRef}
      />

      <PlayerPanel
        activeGame={library.activeGame}
        onReturnHome={() => void controller.returnHome()}
        focusPlayer={() => void player.focusPlayer()}
        frameRef={player.frameRef}
        frameWrapRef={player.frameWrapRef}
        gameAspectRatio={player.gameAspectRatio}
        logsOpen={controller.logsOpen}
        overlayAvailable={controller.overlayAvailable}
        onIframeLoad={controller.handleIframeLoad}
        onRequestFullscreen={() =>
          void controller.handleReservedAction("fullscreen")
        }
        onToggleOverlay={(game) =>
          void controller.setGameSettingsAndFocus(game, overlayTogglePatch(game))
        }
        onToggleShow={(game) =>
          void controller.setGameSettingsAndFocus(game, showTogglePatch(game))
        }
        resetRuntimeError={controller.resetRuntimeError}
        runtimeError={controller.runtimeError}
        setLogsOpen={controller.setLogsOpen}
        textLogLimit={controller.textLogLimit}
        textLogs={controller.textLogs}
      />
    </main>
  );
}
