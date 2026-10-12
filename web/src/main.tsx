// ===== React 挂载入口：整个前端的"点火开关" =====
// 浏览器加载页面后只会执行这一个文件：把 <App /> 整棵界面组件树塞进
// index.html 里 id 为 root 的空 <div>，页面才从空白变成应用

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// 全局样式（按钮、表格、聊天卡片的外观都定义在这里）。
// 在 TS 里直接 import 一个 .css 文件是 Vite 提供的能力，构建时会单独抽出来打包
import './index.css';

// createRoot 是 React 18 的挂载写法：先拿到页面上的"根"，再调 render 把组件画上去。
// 后面的 ! 是 TS 语法"我保证它不是 null"（index.html 里确实有这个 div）
ReactDOM.createRoot(document.getElementById('root')!).render(
  // StrictMode 是开发期的"查错陪练"：会故意把渲染函数多跑一遍，把依赖副作用的
  // 隐藏 Bug 提前逼出来。所以开发时看到组件"渲染两次"是正常现象；
  // 生产构建里它自动失效，不影响线上
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
