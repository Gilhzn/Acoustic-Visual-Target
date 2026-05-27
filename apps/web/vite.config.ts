import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// SharedArrayBuffer (worklet ring + TF.js WASM threads) requires cross-origin
// isolation. These headers enable it in dev/preview; the production host must
// set them too. A postMessage transport fallback covers hosts that cannot.
const crossOriginIsolation = {
  name: "cross-origin-isolation",
  configureServer(server: { middlewares: { use: (fn: Middleware) => void } }) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      next();
    });
  },
};

type Middleware = (
  req: unknown,
  res: { setHeader: (k: string, v: string) => void },
  next: () => void,
) => void;

export default defineConfig({
  plugins: [tsconfigPaths(), crossOriginIsolation],
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          tfjs: [
            "@tensorflow/tfjs",
            "@tensorflow/tfjs-backend-webgpu",
            "@tensorflow-models/coco-ssd",
          ],
          three: ["three"],
        },
      },
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
