console.log("index.tsx loaded");
// 注入 Tailwind —— 必须放在最顶部
const tw = document.createElement("script");
tw.src = "https://cdn.tailwindcss.com";
document.head.appendChild(tw);

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("无法找到挂载的根元素");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
