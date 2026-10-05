import { defineConfig } from "vite";

// Root is web/; runs/ lives one level up and is read via import.meta.glob.
export default defineConfig({
  server: { fs: { allow: [".."] } },
});
