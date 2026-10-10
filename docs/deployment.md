# 部署说明：AI 知识库问答助手上阿里云

> 面向服务器新手的一份"留痕式"部署记录。每一步都附当时实际执行的命令和输出，
> 照着可以做日常运维，出问题可以照着排查。

- 部署日期：2026-10-10
- 服务器：阿里云轻量应用服务器 `139.224.67.182`（Ubuntu，2C2G + 2G swap）
- 服务器已有项目：选品雷达（pick-radar），本部署**不能影响它**
- 访问入口：**`http://139.224.67.182/kb/`**

---

## 1. 架构总览

服务器上现在跑着**两个互相独立的项目**，靠 nginx 按路径分流：

```
浏览器
  │  http://139.224.67.182/
  │    /          → pick-radar（原有项目，不变）
  │    /kb/       → 本项目（AI 知识库问答助手）
  ▼
pick-radar-prod-web 容器（nginx，对外唯一入口 :80）
  │                              │
  │ /api/ → api:4100             │ /kb/ → 剥掉前缀 → ai-kb-app:3001
  ▼                              ▼
选品雷达后端容器组        ai-kb 独立 compose 栈（本项目）
                               ├── ai-kb-app（Node/Express，前端静态页也在这里）
                               └── ai-kb-pg（pgvector/pgvector:pg16，不对外暴露端口）
```

要点：

- 本项目的两个容器**不占用任何对外端口**，只挂在 Docker 内网（pick-radar 的网络 + 自己的 ai-kb_internal 网络）。
- 对外的 80 端口仍由 pick-radar 的 nginx 独占，只新增了一段 `/kb/` 转发规则。
- 数据库卷 `ai-kb_pgdata` 持久保存数据；上传的文件在容器内 `/app/uploads`（容器重建不丢，除非删容器时加了 `-v`）。

## 2. 访问方式与账号

| 项 | 值 |
|---|---|
| 访问地址 | `http://139.224.67.182/kb/`（注意结尾斜杠；`/kb` 会自动 301 跳转） |
| 管理员 | `admin / admin123`（可上传文档、看审计日志） |
| 普通用户 | `demo / demo123`（只能对话） |

> 演示账号密码在首次启动时自动写入数据库，上线前应改掉（改法见 §6 FAQ）。

## 3. 部署全过程留痕

以下按实际执行顺序记录。

### 3.1 服务器上拉取代码（遇到 GitHub TLS 错误及修复）

现象：Ubuntu 22.04 自带的 git 走 HTTP/2 访问 GitHub 会报：

```
fatal: unable to access 'https://github.com/gyysr/ai-kb-assistant/': GnuTLS recv error (-110)
```

修复（把 git 全局降级到 HTTP/1.1，一次配置永久生效）：

```bash
sudo git config --system http.version HTTP/1.1
git clone https://github.com/gyysr/ai-kb-assistant /opt/ai-kb-assistant
```

### 3.2 写入 `.env`（密钥只存在于服务器，不进 git）

```bash
sudo mkdir -p /opt/ai-kb-assistant
sudo tee /opt/ai-kb-assistant/.env > /dev/null <<'EOF'
QWEN_API_KEY=sk-（你的阿里云百炼 Key）
JWT_SECRET=（用 openssl rand -hex 32 现场生成）
NODE_ENV=production
EOF
sudo chmod 600 /opt/ai-kb-assistant/.env   # 只允许 root 读
```

- Qwen Key 只放在这个文件里；代码仓库里只有 `.env.example` 模板。
- `JWT_SECRET` 是签发登录 token 的密钥，**必须用服务器现场生成的随机值**，不要复用别处。

### 3.3 启动本项目 compose 栈

```bash
cd /opt/ai-kb-assistant && sudo docker compose up -d
```

实际输出（节选）：

```
✔ Container ai-kb-pg    Healthy   （pgvector 镜像拉取约 110s）
✔ Container ai-kb-app   Started
```

验证：

```bash
sudo docker compose -f /opt/ai-kb-assistant/docker-compose.yml ps
# NAME        STATUS
# ai-kb-app   Up 33 minutes
# ai-kb-pg    Up 34 minutes (healthy)

sudo docker logs ai-kb-app
# 已创建初始账号: admin / admin123（角色 admin）
# 已创建初始账号: demo / demo123（角色 user）
# BFF 已启动: http://localhost:3001/api/health
```

### 3.4 配置 SSH 免密登录（为了自动化运维）

本机（Mac）生成专用密钥对，公钥装到服务器：

```bash
# Mac 上
ssh-keygen -t ed25519 -f ~/.ssh/ai-kb-aliyun -N '' -C qoder-mac-ai-kb-deploy
cat ~/.ssh/ai-kb-aliyun.pub   # 把这一行追加到服务器的 ~/.ssh/authorized_keys
```

**踩过的坑（新手重点看）**：公钥复制时错了一个字符（`FfL` 抄成 `LfL`），
登录一直 `Permission denied`，服务器端什么都看不出问题——因为 sshd 配置、权限、
用户全对，就是密钥内容对不上私钥。定位方法：

```bash
# Mac 上：由私钥推导公钥，和服务器上的比对，逐字符 diff
ssh-keygen -y -f ~/.ssh/ai-kb-aliyun

# 服务器上：修复 = 删掉错行、追加正确行
sed -i '/（错误的那串）/d' ~/.ssh/authorized_keys
echo '（正确的公钥行）' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

修好后从 Mac 验证：`ssh -i ~/.ssh/ai-kb-aliyun admin@139.224.67.182 'hostname'`。

> **想收回这台 Mac 的登录权限**：删除服务器 `/home/admin/.ssh/authorized_keys` 里
> 注释为 `qoder-mac-ai-kb-deploy` 的那一行即可，立即生效。

### 3.5 nginx 增加 /kb/ 转发（唯一影响 pick-radar 的步骤）

改动文件：`/opt/pick-radar/deploy/nginx.conf`（已备份为 `.bak-20261010`，md5 已核对一致）。

新增内容（插在 `location /` 之前）：

```nginx
location = /kb {
  return 301 /kb/;
}
location /kb/ {
  # 注意顺序：set 必须在 rewrite break 之前——break 会跳过后续所有
  # rewrite 模块指令（含 set），set 写在后面会导致 proxy_pass 拿到空地址报 500
  resolver 127.0.0.11 valid=10s ipv6=off;
  set $kb_app http://ai-kb-app:3001;
  rewrite ^/kb/(.*)$ /$1 break;
  proxy_pass $kb_app;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Connection "";
  proxy_buffering off;        # SSE 流式问答必须关缓冲
  proxy_cache off;
  proxy_read_timeout 3600s;
  client_max_body_size 20m;   # 文档上传放宽到 20MB
}
```

应用（会重建 pick-radar 的 web 容器，站点中断 5-15 秒，vite 有缓存所以很快）：

```bash
# 语法检查（用一次性容器测，不影响线上）
sudo docker run --rm -v /opt/pick-radar/deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:1.27-alpine nginx -t
# 期望：syntax is ok / test is successful

cd /opt/pick-radar && sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build web
```

**踩过的坑**：第一版把 `rewrite` 写在了 `set` 前面，访问 `/kb/` 报 500。
查 nginx 错误日志看到 `using uninitialized "kb_app" variable` + `invalid URL prefix in ""`：
`rewrite ... break` 会终止其后所有 rewrite 模块指令，所以 `set $kb_app` 没执行。
把 `set` 挪到 `rewrite` 前面即修复。

### 3.6 部署后验证（全部通过）

服务器本机（`curl http://127.0.0.1/...`）：

```
GET /               → 200，pick-radar 首页 HTML（旧站无恙）
GET /kb/api/health  → {"code":0,"data":{"status":"up",...}}  （JSON，不再被旧站兜底）
GET /kb/            → 200
GET /kb             → 301 → /kb/
/kb/assets/*.js     → 200 application/javascript（静态资源路径正确）
GET /api/health     → 200（pick-radar 自己的 API 无恙）
```

外网全链路（Mac 上 curl `http://139.224.67.182/kb/...`）：

```
1. 首页 HTML title = "AI 知识库问答助手"                        ✅
2. POST /kb/api/auth/login (admin/admin123) → token             ✅
3. POST /kb/api/upload（传 1 个测试 md）→ chunkCount: 1         ✅
4. GET  /kb/api/documents → 列表能看到刚传的文档                 ✅
5. POST /kb/api/chat（SSE 流式）：
   5.4s 内收到 43 个事件：delta ×N、tool(search_knowledge)、
   sources（命中测试文档，score 0.58）、带 [1] 引用的回答、done   ✅
6. 浏览器实测：登录 → 发消息 → 回答正确引用知识库内容            ✅
```

## 4. 日常运维命令（都在服务器上执行，需 sudo）

```bash
# 查看本项目容器状态
sudo docker compose -f /opt/ai-kb-assistant/docker-compose.yml ps

# 看日志（app 是应用，db 是数据库；-f 表示持续跟踪，Ctrl+C 退出）
sudo docker compose -f /opt/ai-kb-assistant/docker-compose.yml logs -f app
sudo docker logs --tail 100 ai-kb-app          # 等价写法

# 重启 / 停止 / 启动
sudo docker compose -f /opt/ai-kb-assistant/docker-compose.yml restart
sudo docker compose -f /opt/ai-kb-assistant/docker-compose.yml stop
sudo docker compose -f /opt/ai-kb-assistant/docker-compose.yml start

# 服务器整体状态（内存/磁盘）
free -h && df -h /
```

**更新代码到最新版本**（git push 之后，在服务器上）：

```bash
cd /opt/ai-kb-assistant
sudo git pull
sudo docker compose up -d --build        # 只重建有变化的层，数据库卷不动
```

**完全卸载本项目**（不影响 pick-radar）：

```bash
cd /opt/ai-kb-assistant
sudo docker compose down                  # 停容器+删容器，保留数据卷
# sudo docker compose down -v             # 加上 -v 连数据库一起删（不可恢复！）
# 再把 nginx.conf 里 /kb/ 两段删掉并重建 web 容器，就回到部署前
```

## 5. 回滚方案

| 场景 | 操作 |
|---|---|
| /kb/ 打不开，旧站正常 | 先看 `sudo docker logs --tail 50 ai-kb-app`，容器挂了 `sudo docker compose -f /opt/ai-kb-assistant/docker-compose.yml restart` |
| nginx 配置写坏，全站 5xx | `sudo cp /opt/pick-radar/deploy/nginx.conf.bak-20261010 /opt/pick-radar/deploy/nginx.conf`，再 `cd /opt/pick-radar && sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build web` |
| 新版本部署后有问题 | `cd /opt/ai-kb-assistant && sudo git checkout 上一个commit && sudo docker compose up -d --build` |

## 6. FAQ

**Q：怎么改管理员密码？**
A：目前没有改密接口，最简办法：登录后调注册接口新建一个管理员账号使用（或联系开发者加改密功能）。

**Q：上传文档有什么限制？**
A：仅支持 `.pdf / .md / .markdown / .txt`，单个最大 20MB（nginx 层限制；应用层默认更小，见 `server/.env.example` 的 `MAX_FILE_SIZE_MB`）。

**Q：对话响应慢/报错？**
A：`sudo docker logs --tail 50 ai-kb-app` 看错误。常见原因：Qwen Key 欠费/失效（日志会有 401）、服务器内存不足（`free -h` 看 swap 是否用满）。

**Q：如何撤销部署用的 SSH 密钥？**
A：见 §3.4 最后一行说明，删 authorized_keys 里对应那行即可。

**Q：数据库里的数据存在哪？**
A：Docker 卷 `ai-kb_pgdata`。`sudo docker volume inspect ai-kb_pgdata` 可查实际目录。备份：把该卷目录 tar 打包，或 `sudo docker exec ai-kb-pg pg_dump -U kba knowledge_base > backup.sql`。
