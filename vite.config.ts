import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 使用相对路径，适配 GitHub Pages 或任何静态托管
  base: './',
  server: {
    host: '0.0.0.0'
  }
});