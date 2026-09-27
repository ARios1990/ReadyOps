import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^xlsx$/, replacement: r('./node_modules/xlsx/xlsx.mjs') },
      { find: /^pdfjs-dist$/, replacement: r('./node_modules/pdfjs-dist/build/pdf.mjs') },
    ],
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
    include: ['xlsx', 'pdfjs-dist'],
  },
});
