// vite.config.ts
import { defineConfig } from "file:///home/project/node_modules/vite/dist/node/index.js";
import react from "file:///home/project/node_modules/@vitejs/plugin-react/dist/index.mjs";
import { fileURLToPath } from "node:url";
var __vite_injected_original_import_meta_url = "file:///home/project/vite.config.ts";
var r = (p) => fileURLToPath(new URL(p, __vite_injected_original_import_meta_url));
var vite_config_default = defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^xlsx$/, replacement: r("./node_modules/xlsx/xlsx.mjs") },
      { find: /^pdfjs-dist$/, replacement: r("./node_modules/pdfjs-dist/build/pdf.mjs") }
    ]
  },
  optimizeDeps: {
    exclude: ["lucide-react"],
    include: ["xlsx", "pdfjs-dist"]
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9wcm9qZWN0XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9wcm9qZWN0L3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3Byb2plY3Qvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSAnbm9kZTp1cmwnO1xuXG5jb25zdCByID0gKHA6IHN0cmluZykgPT4gZmlsZVVSTFRvUGF0aChuZXcgVVJMKHAsIGltcG9ydC5tZXRhLnVybCkpO1xuXG4vLyBodHRwczovL3ZpdGVqcy5kZXYvY29uZmlnL1xuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3JlYWN0KCldLFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IFtcbiAgICAgIHsgZmluZDogL154bHN4JC8sIHJlcGxhY2VtZW50OiByKCcuL25vZGVfbW9kdWxlcy94bHN4L3hsc3gubWpzJykgfSxcbiAgICAgIHsgZmluZDogL15wZGZqcy1kaXN0JC8sIHJlcGxhY2VtZW50OiByKCcuL25vZGVfbW9kdWxlcy9wZGZqcy1kaXN0L2J1aWxkL3BkZi5tanMnKSB9LFxuICAgIF0sXG4gIH0sXG4gIG9wdGltaXplRGVwczoge1xuICAgIGV4Y2x1ZGU6IFsnbHVjaWRlLXJlYWN0J10sXG4gICAgaW5jbHVkZTogWyd4bHN4JywgJ3BkZmpzLWRpc3QnXSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUF5TixTQUFTLG9CQUFvQjtBQUN0UCxPQUFPLFdBQVc7QUFDbEIsU0FBUyxxQkFBcUI7QUFGb0csSUFBTSwyQ0FBMkM7QUFJbkwsSUFBTSxJQUFJLENBQUMsTUFBYyxjQUFjLElBQUksSUFBSSxHQUFHLHdDQUFlLENBQUM7QUFHbEUsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEVBQUUsTUFBTSxVQUFVLGFBQWEsRUFBRSw4QkFBOEIsRUFBRTtBQUFBLE1BQ2pFLEVBQUUsTUFBTSxnQkFBZ0IsYUFBYSxFQUFFLHlDQUF5QyxFQUFFO0FBQUEsSUFDcEY7QUFBQSxFQUNGO0FBQUEsRUFDQSxjQUFjO0FBQUEsSUFDWixTQUFTLENBQUMsY0FBYztBQUFBLElBQ3hCLFNBQVMsQ0FBQyxRQUFRLFlBQVk7QUFBQSxFQUNoQztBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
