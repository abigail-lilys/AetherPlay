// AETHER_SW_INDEXEDDB_VERSION_FIX_V1
// AETHER_SW_WAIT_FOR_CONTROLLER_V1
const PLAYER_SERVICE_WORKER_VERSION = "player-sw-16";
const SW_LIFECYCLE_TIMEOUT_MS = 20000;

function waitForExpectedWorkerActivation(
  registration: ServiceWorkerRegistration,
  expectedScriptURL: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let observedWorker: ServiceWorker | null = null;
    let timeoutId: number | undefined;

    const cleanup = () => {
      registration.removeEventListener("updatefound", inspect);
      observedWorker?.removeEventListener("statechange", inspect);

      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };

    const fail = (message: string) => {
      cleanup();
      reject(new Error(message));
    };

    const inspect = () => {
      if (observedWorker?.state === "redundant") {
        fail(
          `Player Service Worker became redundant: ${expectedScriptURL}`,
        );
        return;
      }

      const worker =
        [
          registration.installing,
          registration.waiting,
          registration.active,
        ].find(
          (candidate) => candidate?.scriptURL === expectedScriptURL,
        ) ?? null;

      if (worker !== observedWorker) {
        observedWorker?.removeEventListener("statechange", inspect);
        observedWorker = worker;
        observedWorker?.addEventListener("statechange", inspect);
      }

      if (observedWorker?.state === "activated") {
        cleanup();
        resolve();
      } else if (observedWorker?.state === "redundant") {
        fail(
          `Player Service Worker failed to activate: ${expectedScriptURL}`,
        );
      }
    };

    registration.addEventListener("updatefound", inspect);

    timeoutId = window.setTimeout(() => {
      fail(
        [
          "Timed out waiting for Player Service Worker activation.",
          `Expected: ${expectedScriptURL}`,
          `Installing: ${registration.installing?.state ?? "none"}`,
          `Waiting: ${registration.waiting?.state ?? "none"}`,
          `Active: ${registration.active?.state ?? "none"}`,
        ].join("\n"),
      );
    }, SW_LIFECYCLE_TIMEOUT_MS);

    inspect();
  });
}

function waitForExpectedController(
  expectedScriptURL: string,
): Promise<void> {
  const currentController = () =>
    navigator.serviceWorker.controller?.scriptURL ?? "(none)";

  if (currentController() === expectedScriptURL) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let timeoutId: number | undefined;

    const cleanup = () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );

      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };

    const onControllerChange = () => {
      if (currentController() === expectedScriptURL) {
        cleanup();
        resolve();
      }
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );

    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(
        new Error(
          [
            "Timed out waiting for the new Player Service Worker to control this page.",
            `Expected: ${expectedScriptURL}`,
            `Current: ${currentController()}`,
          ].join("\n"),
        ),
      );
    }, SW_LIFECYCLE_TIMEOUT_MS);

    // Recheck after registering the listener to avoid a race.
    onControllerChange();
  });
}

export async function registerPlayerServiceWorker(): Promise<
  ServiceWorkerRegistration | undefined
> {
  if (!("serviceWorker" in navigator)) return undefined;

  const scriptURL = new URL(
    `/player-sw.js?v=${PLAYER_SERVICE_WORKER_VERSION}`,
    window.location.origin,
  ).href;

  const registration = await navigator.serviceWorker.register(
    scriptURL,
    { scope: "/" },
  );

  // Do not allow game startup while an old worker still controls the page.
  await waitForExpectedWorkerActivation(registration, scriptURL);
  await waitForExpectedController(scriptURL);

  console.info(
    "[AetherPlay] Player Service Worker is ready and controlling this page:",
    scriptURL,
  );

  return registration;
}
