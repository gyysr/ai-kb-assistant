# ---------- 前端构建（/kb/ 前缀） ----------
FROM node:20-alpine AS web-builder
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build -- --base=/kb/

# ---------- 后端构建 ----------
FROM node:20-alpine AS server-builder
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---------- 运行时 ----------
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=server-builder /build/server/node_modules ./server/node_modules
COPY --from=server-builder /build/server/dist ./server/dist
COPY --from=server-builder /build/server/package.json ./server/package.json
COPY --from=web-builder /build/web/dist ./web/dist
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["node", "server/dist/index.js"]
