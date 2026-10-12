# docs/ —— 文档中心

这个文件夹存放随代码入库的三份长文档，分别回答三个不同的问题：

| 文档 | 回答的问题 | 什么时候读 |
| --- | --- | --- |
| [changes.md](changes.md) | 这个项目**每次变更**都做了什么、为什么、怎么验证的（面向零基础读者的变更日志，含概念词汇表和踩坑速查表） | 想了解项目演进过程 / 复盘某个功能是怎么做出来的 |
| [article.md](article.md) | 用 Node.js BFF 搭建 RAG 知识库系统的**技术文章**（可发布的完整叙述，覆盖架构选型与全链路实现） | 想系统性理解整体架构、或写简历/面试前通读 |
| [deployment.md](deployment.md) | 怎么把项目**部署到服务器**（nginx 路由、docker compose、运维命令、回滚、FAQ） | 要部署、升级、排障时照着做 |

## 快速导航

- **完全零基础**：先读 changes.md 开头的「读前须知：6 个概念」词汇表，再按时间线读各阶段。
- **想跑起来**：根目录 [README.md](../README.md) 的「快速开始」。
- **想看代码**：[server/README.md](../server/README.md)（后端结构+API+SSE 协议）、[web/README.md](../web/README.md)（前端结构+关键设计）——源码里也已补齐教学注释。
- **想验证质量**：[eval/README.md](../eval/README.md)（评测怎么跑、结果怎么看）。
