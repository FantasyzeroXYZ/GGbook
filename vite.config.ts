import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const repoName = 'GGbook'; // 仓库名称

  return {
    plugins: [react()],
    base: mode === 'production' ? `/${repoName}/` : '/',
    server: {
      host: true,       // ← 开放局域网访问
      port: 3000,
      open: true,
      strictPort: true,
    },
    build: {
      outDir: 'dist',
    },
  };
});
