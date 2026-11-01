import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

export type DirectionPadMode = "instant" | "drag";

type Direction = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";
type Action = Direction | "MOUSE_RIGHT" | "Shift" | "Escape" | "Enter";

interface Props {
  side: "left" | "right";
  frameRef: RefObject<HTMLIFrameElement | null>;
  directionMode: DirectionPadMode;
}

const KEY_INFO: Record<string, { key: string; code: string; keyCode: number }> = {
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  Shift: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Enter: { key: "Enter", code: "Enter", keyCode: 13 },
};

function sendInput(
  frame: RefObject<HTMLIFrameElement | null>,
  action: Action,
  down: boolean,
) {
  const win = frame.current?.contentWindow as (Window & typeof globalThis) | null;
  if (!win) return;

  try {
    const doc = win.document;
    const target =
      doc.querySelector<HTMLElement>("#canvas, canvas") ||
      doc.activeElement ||
      doc;

    if (action === "MOUSE_RIGHT") {
      target.dispatchEvent(new win.MouseEvent(
        down ? "mousedown" : "mouseup",
        {
          bubbles: true,
          cancelable: true,
          button: 2,
          buttons: down ? 2 : 0,
          view: win,
        },
      ));
      return;
    }

    const info = KEY_INFO[action];
    const event = new win.KeyboardEvent(
      down ? "keydown" : "keyup",
      {
        key: info.key,
        code: info.code,
        bubbles: true,
        cancelable: true,
        composed: true,
      },
    );

    try {
      Object.defineProperty(event, "keyCode", {
        get: () => info.keyCode,
      });
      Object.defineProperty(event, "which", {
        get: () => info.keyCode,
      });
    } catch {}

    target.dispatchEvent(event);
  } catch (error) {
    console.warn("[AetherPlay controls]", error);
  }
}

export function VirtualGameControls({
  side,
  frameRef,
  directionMode,
}: Props) {
  const held = useRef(new Map<string, Action>());
  const dragPointer = useRef<number | null>(null);
  const dragDirection = useRef<Direction | null>(null);

  function press(source: string, action: Action) {
    const previous = held.current.get(source);
    if (previous === action) return;
    if (previous) release(source);

    const alreadyHeld = [...held.current.values()].includes(action);
    held.current.set(source, action);

    if (!alreadyHeld) sendInput(frameRef, action, true);
  }

  function release(source: string) {
    const action = held.current.get(source);
    if (!action) return;

    held.current.delete(source);
    if (![...held.current.values()].includes(action)) {
      sendInput(frameRef, action, false);
    }
  }

  function releaseAll() {
    const actions = new Set(held.current.values());
    held.current.clear();
    for (const action of actions) sendInput(frameRef, action, false);
    dragPointer.current = null;
    dragDirection.current = null;
  }

  function buttonDown<T extends HTMLElement>(
    event: ReactPointerEvent<T>,
    action: Action,
  ) {
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    press("pointer:" + event.pointerId, action);
  }

  function buttonUp<T extends HTMLElement>(event: ReactPointerEvent<T>) {
    event.preventDefault();
    event.stopPropagation();
    release("pointer:" + event.pointerId);
  }

  function updateDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dx = (event.clientX - rect.left - rect.width / 2) / (rect.width / 2);
    const dy = (event.clientY - rect.top - rect.height / 2) / (rect.height / 2);

    let next: Direction | null = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= 0.18) {
      if (Math.abs(dx) > Math.abs(dy)) {
        next = dx < 0 ? "ArrowLeft" : "ArrowRight";
      } else {
        next = dy < 0 ? "ArrowUp" : "ArrowDown";
      }
    }

    if (next === dragDirection.current) return;
    release("drag");
    dragDirection.current = next;
    if (next) press("drag", next);
  }

  function dragStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragPointer.current = event.pointerId;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    updateDrag(event);
  }

  function dragMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragPointer.current !== event.pointerId) return;
    event.preventDefault();
    updateDrag(event);
  }

  function dragEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragPointer.current !== event.pointerId) return;
    event.preventDefault();
    dragPointer.current = null;
    dragDirection.current = null;
    release("drag");
  }

  useEffect(() => {
    const blur = () => releaseAll();
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("blur", blur);
      releaseAll();
    };
  }, []);

  useEffect(() => {
    releaseAll();
  }, [directionMode]);

  if (side === "left") {
    return (
      <aside className="virtual-control-panel virtual-control-left">
        <button
          type="button"
          className="virtual-control-item"
          aria-label="Hold right mouse button"
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => buttonDown(e, "MOUSE_RIGHT")}
          onPointerUp={buttonUp}
          onPointerCancel={buttonUp}
          onLostPointerCapture={buttonUp}
        >
          <span className="virtual-hold-icon">🖱</span>
          <span>HOLD</span>
        </button>

        <div className="virtual-control-item virtual-direction-area">
          <div
            className={"virtual-dpad-grid " + directionMode}
            onPointerDown={directionMode === "drag" ? dragStart : undefined}
            onPointerMove={directionMode === "drag" ? dragMove : undefined}
            onPointerUp={directionMode === "drag" ? dragEnd : undefined}
            onPointerCancel={directionMode === "drag" ? dragEnd : undefined}
            onLostPointerCapture={directionMode === "drag" ? dragEnd : undefined}
          >
            {directionMode === "instant" ? (
              <>
                <button className="virtual-arrow up" aria-label="Up"
                  onPointerDown={(e) => buttonDown(e, "ArrowUp")}
                  onPointerUp={buttonUp} onPointerCancel={buttonUp}
                  onLostPointerCapture={buttonUp}>▲</button>
                <button className="virtual-arrow left" aria-label="Left"
                  onPointerDown={(e) => buttonDown(e, "ArrowLeft")}
                  onPointerUp={buttonUp} onPointerCancel={buttonUp}
                  onLostPointerCapture={buttonUp}>◀</button>
                <span className="virtual-dpad-center">●</span>
                <button className="virtual-arrow right" aria-label="Right"
                  onPointerDown={(e) => buttonDown(e, "ArrowRight")}
                  onPointerUp={buttonUp} onPointerCancel={buttonUp}
                  onLostPointerCapture={buttonUp}>▶</button>
                <button className="virtual-arrow down" aria-label="Down"
                  onPointerDown={(e) => buttonDown(e, "ArrowDown")}
                  onPointerUp={buttonUp} onPointerCancel={buttonUp}
                  onLostPointerCapture={buttonUp}>▼</button>
              </>
            ) : (
              <>
                <span className="virtual-dpad-mark up">▲</span>
                <span className="virtual-dpad-mark left">◀</span>
                <span className="virtual-dpad-center">●</span>
                <span className="virtual-dpad-mark right">▶</span>
                <span className="virtual-dpad-mark down">▼</span>
              </>
            )}
          </div>
          <span className="virtual-dpad-mode-label">
            {directionMode === "drag" ? "DRAG" : "TAP"}
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="virtual-control-panel virtual-control-right">
      <button type="button" className="virtual-control-item"
        aria-label="Sub / Shift"
        onPointerDown={(e) => buttonDown(e, "Shift")}
        onPointerUp={buttonUp} onPointerCancel={buttonUp}
        onLostPointerCapture={buttonUp}>
        <span className="virtual-action-key">Sub</span>
      </button>

      <button type="button" className="virtual-control-item"
        aria-label="Cancel / Escape"
        onPointerDown={(e) => buttonDown(e, "Escape")}
        onPointerUp={buttonUp} onPointerCancel={buttonUp}
        onLostPointerCapture={buttonUp}>
        <span className="virtual-action-key">Cancel</span>
      </button>

      <button type="button" className="virtual-control-item"
        aria-label="Enter"
        onPointerDown={(e) => buttonDown(e, "Enter")}
        onPointerUp={buttonUp} onPointerCancel={buttonUp}
        onLostPointerCapture={buttonUp}>
        <span className="virtual-enter-icon">↵</span>
      </button>
    </aside>
  );
}
