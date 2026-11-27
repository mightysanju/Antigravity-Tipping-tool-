import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteDevApiPlugin } from './src/server/viteDevApiPlugin.ts';

export default defineConfig({
  plugins: [react(), tailwindcss(), viteDevApiPlugin()],
});
