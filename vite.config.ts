import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 如果你的 GitHub Pages 部署在子路径下（例如 user.github.io/repo-name/），
  // 请取消下面一行的注释并将 '/repo-name/' 替换为你的仓库名称
  // base: '/react-epub-reader/',
});