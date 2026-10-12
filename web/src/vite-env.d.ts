// ===== Vite 环境类型声明：给 TS 编译器补的"背景知识" =====
// 整个文件只有一行三斜线指令：引入 Vite 自带的类型定义。有了它，代码里
// 写 import.meta.env（读环境变量）、import './index.css' 这类 Vite 专属
// 写法时 TS 才认识、不报错。它只给编译器看，不产生任何运行代码

/// <reference types="vite/client" />
