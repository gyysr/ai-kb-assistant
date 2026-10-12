# ============ Dockerfile：多阶段构建 ============
# 为什么分阶段？构建工具（TypeScript 编译器、Vite、开发依赖）只在一阶段用，
# 最终镜像只拷贝"编译产物"，不带源码和工具——镜像更小、攻击面更小。
# 三个阶段：web-builder（构建前端）→ server-builder（构建后端）→ 运行时（真正跑起来的）

# ---------- 阶段 1：前端构建（/kb/ 前缀） ----------
FROM node:20-alpine AS web-builder
WORKDIR /build/web
# 先只拷贝 package*.json 再 npm ci：依赖没变时 Docker 会命中缓存，跳过重装依赖
# （本机改了前端代码重新构建时，这两层缓存能省掉几分钟）
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# --base=/kb/：生产环境网站挂在 nginx 的 /kb/ 路径下，
# 前端打包出来的 js/css 引用路径必须带 /kb/ 前缀，否则浏览器会 404
RUN npm run build -- --base=/kb/

# ---------- 阶段 2：后端构建 ----------
FROM node:20-alpine AS server-builder
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
# tsc 编译 TS → dist/；prune --omit=dev 删掉 devDependencies（测试工具等），
# 运行时用不到它们，删掉能让最终镜像小一大截
RUN npm run build && npm prune --omit=dev

# ---------- 阶段 3：运行时（干净的小镜像） ----------
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
# 只从上面两个"施工阶段"拷贝成品，不拷源码
COPY --from=server-builder /build/server/node_modules ./server/node_modules
COPY --from=server-builder /build/server/dist ./server/dist
COPY --from=server-builder /build/server/package.json ./server/package.json
COPY --from=web-builder /build/web/dist ./web/dist
# uploads 是用户上传文件的存放目录；chown 给内置的 node 用户并以它运行，
# 不用 root 跑应用是容器安全的基本要求（就算被攻破，权限也有限）
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["node", "server/dist/index.js"]
