// @ts-nocheck

import { FOCUS_RETURN_EVENT_TYPES } from "@/player-runtime/bridge/constants";
import { exactModifierMatch } from "@/player-runtime/bridge/keyEvents";

export function createOverlayInputController({
  overlayState,
  postParentMessage,
  settings,
}) {
  function installOverlayFocusReturn() {
    if (!overlayState.root || overlayState.focusReturnInstalled) return;
    overlayState.focusReturnInstalled = true;

    const trackOverlayText = (event) => {
      const entry = overlayTextEntry(event.target);
      if (!entry) return;
      overlayState.hoveredTextEntry = entry;
    };

    const clearOverlayText = (event) => {
      if (!overlayState.hoveredTextEntry) return;
      if (
        event.relatedTarget instanceof Node &&
        overlayState.root.contains(event.relatedTarget)
      ) {
        return;
      }
      overlayState.hoveredTextEntry = null;
    };

    const consumeOverlayTextPointerEvent = (event) => {
      const entry = overlayTextEntry(event.target);
      if (!entry) return;
      overlayState.hoveredTextEntry = entry;
      event.stopPropagation();
    };

    const restoreGameFocusAfterSurfacePointer = (event) => {
      if (
        overlayTextEntry(event.target) ||
        !eventTargetsGameSurface(event.target)
      )
        return;
      if (!FOCUS_RETURN_EVENT_TYPES.includes(event.type)) return;
      window.setTimeout(() => {
        focusGameTarget();
        returnFocus();
      }, 0);
    };

    const returnFocus = () => {
      if (!settings.readerMode) return;
      window.setTimeout(() => {
        postParentMessage({ type: "return-focus" });
      }, 0);
    };

    for (const type of [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "click",
      "dblclick",
      "contextmenu",
      "touchstart",
      "touchend",
    ]) {
      window.addEventListener(type, consumeOverlayTextPointerEvent, true);
      window.addEventListener(type, restoreGameFocusAfterSurfacePointer, true);
    }
    overlayState.root.addEventListener("pointerover", trackOverlayText, true);
    overlayState.root.addEventListener("pointermove", trackOverlayText, true);
    overlayState.root.addEventListener("pointerdown", trackOverlayText, true);
    overlayState.root.addEventListener("pointerup", returnFocus, true);
    overlayState.root.addEventListener("mouseup", returnFocus, true);
    overlayState.root.addEventListener("touchend", returnFocus, true);
    overlayState.root.addEventListener("click", returnFocus, true);
    overlayState.root.addEventListener("pointerout", clearOverlayText, true);

    for (const type of ["keydown", "keypress", "keyup"]) {
      window.addEventListener(type, handleDictionaryGuardKeyEvent, true);
    }
    window.addEventListener("blur", clearGuardState, true);
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState !== "visible") clearGuardState();
      },
      true,
    );
  }

  function dictionaryGuardActive() {
    return Boolean(
      settings.overlayEnabled &&
      settings.dictionaryDismissGuard?.enabled &&
      settings.dictionaryDismissGuard.triggers?.length,
    );
  }

  function installDictionaryGuardInputHooks() {
    if (overlayState.inputGuardInstalled) return;

    const install = () => {
      if (overlayState.inputGuardInstalled) return true;
      const input = window.Input;
      if (
        !input ||
        typeof input._onKeyDown !== "function" ||
        typeof input._onKeyUp !== "function"
      ) {
        return false;
      }

      overlayState.inputGuardInstalled = true;
      const originalKeyDown = input._onKeyDown;
      const originalKeyUp = input._onKeyUp;

      input._onKeyDown = function (event) {
        if (dictionaryGuardInputShouldBlock(event)) {
          overlayState.consumedGuardKeyCodes.add(event.code);
          releaseRpgMakerInputState(event);
          consumeEvent(event);
          return;
        }
        return originalKeyDown.apply(this, arguments);
      };

      input._onKeyUp = function (event) {
        if (
          overlayState.consumedGuardKeyCodes.has(event.code) ||
          dictionaryGuardInputShouldBlock(event)
        ) {
          overlayState.consumedGuardKeyCodes.delete(event.code);
          releaseRpgMakerInputState(event);
          consumeEvent(event);
          return;
        }
        return originalKeyUp.apply(this, arguments);
      };

      return true;
    };

    if (install()) return;
    setTimeout(installDictionaryGuardInputHooks, 250);
  }

  function clearGuardState() {
    overlayState.consumedGuardKeyCodes.clear();
  }

  function focusGameTarget() {
    const graphics = window.Graphics || {};
    const canvas = graphics._canvas || document.querySelector("canvas");
    const target = canvas || document.body || document.documentElement;
    try {
      window.focus();
    } catch {
      // Some hosts ignore scripted frame focus.
    }
    focusElement(document.documentElement);
    focusElement(document.body);
    focusElement(target);
    if (canvas && canvas !== target) focusElement(canvas);
  }

  function handleDictionaryGuardKeyEvent(event) {
    if (event.code === "Escape") {
      clearGuardState();
      return;
    }
    maybeConsumeDictionaryDismissKeyEvent(event);
  }

  function maybeConsumeDictionaryDismissKeyEvent(event) {
    if (
      event.type === "keyup" &&
      overlayState.consumedGuardKeyCodes.has(event.code)
    ) {
      overlayState.consumedGuardKeyCodes.delete(event.code);
      releaseRpgMakerInputState(event);
      consumeEvent(event);
      return true;
    }
    if (event.type === "keyup" && guardReleaseMatchesKeyEvent(event)) {
      overlayState.consumedGuardKeyCodes.delete(event.code);
      releaseRpgMakerInputState(event);
      consumeEvent(event);
      return true;
    }
    if (!dictionaryGuardActive()) return false;
    const match = settings.dictionaryDismissGuard.triggers.find((trigger) =>
      guardTriggerMatchesKeyEvent(event, trigger),
    );
    if (!match) return false;
    releaseRpgMakerInputState(event);
    consumeEvent(event);
    if (event.type === "keydown")
      overlayState.consumedGuardKeyCodes.add(event.code);
    if (event.type === "keyup")
      overlayState.consumedGuardKeyCodes.delete(event.code);
    return true;
  }

  function dictionaryGuardInputShouldBlock(event) {
    if (!dictionaryGuardActive()) return false;
    return settings.dictionaryDismissGuard.triggers.some((trigger) =>
      guardTriggerMatchesKeyEvent(event, trigger),
    );
  }

  function guardReleaseMatchesKeyEvent(event) {
    if (
      !settings.dictionaryDismissGuard?.enabled ||
      !settings.dictionaryDismissGuard.triggers?.length
    ) {
      return false;
    }
    return settings.dictionaryDismissGuard.triggers.some((trigger) => {
      if (trigger.code) return event.code === trigger.code;
      return modifierOnlyTriggerMatchesEventCode(event.code, trigger);
    });
  }

  function guardTriggerMatchesKeyEvent(event, trigger) {
    if (!exactModifierMatch(event, trigger)) return false;
    if (trigger.code) return event.code === trigger.code;
    return modifierOnlyTriggerMatchesEventCode(event.code, trigger);
  }

  function modifierOnlyTriggerMatchesEventCode(code, trigger) {
    return (
      (trigger.altKey && (code === "AltLeft" || code === "AltRight")) ||
      (trigger.ctrlKey &&
        (code === "ControlLeft" || code === "ControlRight")) ||
      (trigger.metaKey && (code === "MetaLeft" || code === "MetaRight")) ||
      (trigger.shiftKey && (code === "ShiftLeft" || code === "ShiftRight"))
    );
  }

  function releaseRpgMakerInputState(event) {
    const input = window.Input;
    const keyName = input?.keyMapper?.[event.keyCode];
    if (!keyName || !input._currentState) return;
    input._currentState[keyName] = false;
    if (input._latestButton === keyName) input._latestButton = null;
  }

  function consumeEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }

  return {
    clearGuardState,
    dictionaryGuardActive,
    focusGameTarget,
    installDictionaryGuardInputHooks,
    installOverlayFocusReturn,
  };
}

function overlayTextEntry(target) {
  return target instanceof Element
    ? target.closest(".mz-player-text-overlay-entry")
    : null;
}

function eventTargetsGameSurface(target) {
  if (
    target === document ||
    target === document.body ||
    target === document.documentElement
  ) {
    return true;
  }
  return target instanceof Element && Boolean(target.closest("canvas, video"));
}

function focusElement(target) {
  if (!target || typeof target.focus !== "function") return;
  try {
    if (target instanceof HTMLElement && !target.hasAttribute("tabindex")) {
      target.tabIndex = -1;
    }
    if (target instanceof HTMLElement) target.style.outline = "none";
    target.focus({ preventScroll: true });
  } catch {
    try {
      target.focus();
    } catch {
      // Focus is best-effort
      // Gameplay still works once the frame is active.
    }
  }
}
