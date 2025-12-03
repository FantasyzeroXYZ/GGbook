import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/GGbook/',   // ⭐ 必须是这样
  server: {
    host: '0.0.0.0'
  }
});
