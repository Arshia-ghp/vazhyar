import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

function normalizeBase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}/`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
  const inferredPagesBase = process.env.GITHUB_ACTIONS === "true" && repositoryName
    ? `/${repositoryName}/`
    : "/";
  const base = normalizeBase(env.VITE_BASE_PATH || process.env.VITE_BASE_PATH || inferredPagesBase);
  const asset = (name: string) => `${base}${name}`;

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "prompt",
        includeAssets: ["favicon.svg", "apple-touch-icon.png"],
        manifest: {
          id: base,
          name: "واژه‌یار | یادگیری انگلیسی",
          short_name: "واژه‌یار",
          description: "دفترچه شخصی یادگیری و مرور زبان انگلیسی به فارسی",
          lang: "fa",
          dir: "rtl",
          start_url: base,
          scope: base,
          display: "standalone",
          orientation: "any",
          background_color: "#f5f3ff",
          theme_color: "#6d5ce7",
          categories: ["education", "productivity"],
          icons: [
            { src: asset("pwa-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
            { src: asset("pwa-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
            { src: asset("pwa-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" }
          ]
        },
        workbox: {
          // Namespace Workbox caches so the maintenance button never deletes
          // caches belonging to another PWA on the same GitHub Pages origin.
          cacheId: "vazhyar",
          globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"],
          navigateFallback: "index.html",
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: false,
          // Never cache user API responses; IndexedDB remains the source of truth.
          runtimeCaching: []
        },
        devOptions: { enabled: false }
      })
    ],
    server: { host: "0.0.0.0", port: 5173, strictPort: true }
  };
});
