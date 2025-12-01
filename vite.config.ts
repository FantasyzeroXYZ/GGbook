import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 配置
export default defineConfig(({ mode }) => {
  // 如果你的 GitHub Pages 仓库子路径
  const repoName = 'react-epub-reader'; // 修改为你的仓库名称

  return {
    plugins: [react()],
    base: mode === 'production' ? `/${repoName}/` : '/', // 本地 '/'，部署到 GitHub Pages '/repo-name/'
    server: {
      port: 3000,
      open: true,
      strictPort: true,
    },
    build: {
      outDir: 'dist', // 输出目录
    },
  };
});
