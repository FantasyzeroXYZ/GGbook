import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// 忽略 ResizeObserver 循环限制错误
// 这是 epubjs 结合 React 布局计算时的常见良性错误，通常不影响功能
// 只有在开发模式下或特定浏览器中才会抛出此错误
const ignoreResizeObserverLoop = (e: ErrorEvent) => {
    const msg = e.message;
    if (
        msg.includes('ResizeObserver') || 
        msg.includes('循环已完成') || 
        msg.includes('loop limit exceeded') ||
        msg.includes('undelivered notifications')
    ) {
        e.stopImmediatePropagation();
        e.preventDefault();
    }
};
window.addEventListener('error', ignoreResizeObserverLoop);

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