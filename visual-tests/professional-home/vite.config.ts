import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const root = path.resolve(import.meta.dirname);
const repositoryRoot = path.resolve(root, "..", "..");

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: "@/_core/hooks/useAuth",
        replacement: path.resolve(root, "authMock.ts"),
      },
      {
        find: "@/lib/trpc",
        replacement: path.resolve(root, "trpcMock.ts"),
      },
      {
        find: "@",
        replacement: path.resolve(repositoryRoot, "client", "src"),
      },
      {
        find: "@shared",
        replacement: path.resolve(repositoryRoot, "shared"),
      },
    ],
  },
  build: {
    outDir: path.resolve(repositoryRoot, "dist", "visual-professional-home"),
    emptyOutDir: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4174,
  },
});
