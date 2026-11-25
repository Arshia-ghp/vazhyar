import { registerSW } from "virtual:pwa-register";

let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null;
let hasRegisteredPwa = false;
let registration: ServiceWorkerRegistration | null = null;

export function registerPwaLifecycle(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || hasRegisteredPwa) return;
  hasRegisteredPwa = true;

  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new Event("vazhyar:pwa-update"));
    },
    onOfflineReady() {
      window.dispatchEvent(new Event("vazhyar:pwa-offline-ready"));
    },
    onRegisteredSW(_swUrl, swRegistration) {
      registration = swRegistration ?? null;
      if (!registration) return;
      // Check for a deployed version when the app returns to the foreground.
      const updateOnVisible = () => {
        if (document.visibilityState === "visible") void registration?.update().catch(() => undefined);
      };
      document.addEventListener("visibilitychange", updateOnVisible);
      window.addEventListener("online", updateOnVisible);
    },
    onRegisterError(error: unknown) {
      console.warn("PWA service worker registration failed", error);
    }
  });
}

export async function applyPwaUpdate(): Promise<void> {
  await updateServiceWorker?.(true);
}

/**
 * Troubleshooting utility. It only unregisters Service Workers and deletes
 * CacheStorage entries; it never touches IndexedDB or localStorage.
 */
export async function clearVazhyarPwaCaches(): Promise<{ registrations: number; caches: number }> {
  if (typeof window === "undefined") return { registrations: 0, caches: 0 };
  let registrations = 0;
  let caches = 0;
  const appScope = new URL(import.meta.env.BASE_URL, window.location.origin).href;
  if ("serviceWorker" in navigator) {
    const allRegistrations = await navigator.serviceWorker.getRegistrations();
    for (const item of allRegistrations) {
      // GitHub Pages can host several repositories as separate PWAs on one
      // origin. Unregister only this app's exact scope.
      if (item.scope === appScope) {
        if (await item.unregister()) registrations += 1;
      }
    }
  }
  if ("caches" in window) {
    const cacheStorage = window.caches;
    const keys = await cacheStorage.keys();
    const appPath = new URL(import.meta.env.BASE_URL, window.location.origin).pathname;
    for (const key of keys) {
      let belongsToThisApp = key.startsWith("vazhyar-");
      // Remove legacy Workbox caches from earlier Vazhyar builds only when a
      // repository-scoped GitHub Pages path proves every cached URL belongs
      // to this app. On root domains, generic Workbox caches are left alone.
      if (!belongsToThisApp && appPath !== "/" && /^workbox-(precache|runtime)-/i.test(key)) {
        try {
          const cache = await cacheStorage.open(key);
          const requests = await cache.keys();
          belongsToThisApp = requests.length > 0 && requests.every((request) => {
            const url = new URL(request.url);
            return url.origin === window.location.origin && url.pathname.startsWith(appPath);
          });
        } catch {
          belongsToThisApp = false;
        }
      }
      if (belongsToThisApp && await cacheStorage.delete(key)) caches += 1;
    }
  }
  hasRegisteredPwa = false;
  updateServiceWorker = null;
  registration = null;
  return { registrations, caches };
}
