import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("无法找到挂载的根元素");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  // StrictMode 在开发模式下可能会导致 Effect 执行两次，对于复杂的类逻辑可能比较棘手，
  // 但我们会处理好它。
  <React.StrictMode>
    <App />
  </React.StrictMode>
);