# 部署说明：AI 知识库问答助手上阿里云

> 面向服务器新手的一份"留痕式"部署记录。每一步都附当时实际执行的命令和输出，
> 照着可以做日常运维，出问题可以照着排查。

- 部署日期：2026-10-10
- 服务器：阿里云轻量应用服务器 `139.224.67.182`（Ubuntu，2C2G + 2G swap）
- 服务器已有项目：选品雷达（pick-radar），本部署**不能影响它**
- 访问入口：**`http://139.224.67.182/kb/`**

---

## 1. 架构总览

服务器上现在跑着**两个互相独立的项目**，由一个专属的「边缘网关」容器按路径分流。
（2026-10-12 起为此架构。最初是借用 pick-radar 的 nginx 加转发规则——结果它一次
部署就把规则覆盖掉、/kb/ 挂了，于是彻底解耦，完整复盘见 §3.7。）

```
浏览器
  │  http://139.224.67.182/
  │    /          → pick-radar（原有项目）
  │    /kb/       → 本项目（AI 知识库问答助手）
  ▼
edge-nginx 容器（对外唯一入口 :80，编排与配置在本仓库 deploy/edge/）
  │                              │
  │ / → pick-radar-prod-web-1    │ /kb/ → 剥掉前缀 → ai-kb-app:3001
  ▼                              ▼
pick-radar 容器组               ai-kb 独立 compose 栈（本项目）
（web 也只在 Docker 内网监听，   ├── ai-kb-app（Node/Express，前端静态页也在这里）
 不再占宿主机 80）               └── ai-kb-pg（pgvector/pgvector:pg16，不对外暴露端口）
```

要点：

- **80 端口由 `edge-nginx` 独占**，它的编排与配置就在本仓库 `deploy/edge/` 里
  （git 版本管理）。pick-radar 的部署脚本只会 rsync 它自己的目录，永远碰不到
  这里——这正是解耦的关键。
- 本项目的两个容器不占用任何对外端口，只挂 Docker 内网；pick-radar 的 web 容器
  同样只在 Docker 内网监听（它的 compose 已删掉 ports 映射，Mac 源码同步改过）。
- 数据库卷 `ai-kb_pgdata` 持久保存数据；上传的文件在容器内 `/app/uploads`（容器重建不丢，除非删容器时加了 `-v`）。

## 2. 访问方式与账号

| 项 | 值 |
|---|---|
| 访问地址 | `http://139.224.67.182/kb/`（结尾斜杠；漏写时边缘网关会自动 308 跳转补全） |
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

### 3.5 nginx 增加 /kb/ 转发（⚠️ 已废弃的原始方案，仅作留痕）

> **2026-10-12 起此方案已被边缘网关取代（见 §3.7）**。把 /kb/ 路由写进 pick-radar
> 的配置文件，等于把知识库的可用性押在"对方永远不重新部署"上——当天它跑了一次
> `deploy.sh`（`rsync --delete`），路由块被覆盖、/kb/ 挂掉，连本节提到的
> `.bak-20261010` 备份也被 --delete 一并删掉。下文保留原始记录供复盘。

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

### 3.7 边缘网关上线：/kb/ 与 pick-radar 彻底解耦（2026-10-12 故障复盘）

**故障经过**：2026-10-12 下午，pick-radar 更新 UI 时跑了它自己的部署脚本
`deploy.sh`。该脚本用 `rsync -az --delete` 把 Mac 上的文件同步到服务器
`/opt/pick-radar/`——`--delete` 的含义是"服务器上多出来的文件一律删掉"。于是：

- 服务器上被手工改过的 `deploy/nginx.conf`（含 §3.5 加的 /kb/ 路由块）被仓库原版**覆盖**；
- 手工做的备份 `nginx.conf.bak-20261010` 被 --delete **直接删掉**。

症状：访问 `/kb/` 返回的是 pick-radar 的前端 HTML（兜底路由接住了请求），
知识库看起来"崩了"，但其实 ai-kb 两个容器全程健康——坏的只是入口路由。

**根因**：两个项目共用一份**会被对方部署流程覆盖**的配置文件。pick-radar 每重新
部署一次，/kb/ 就挂一次——结构性问题，靠"下次记得改回来"无解。

**方案：加一层独立的边缘网关（edge nginx），谁的配置谁自己管**

三个动作（commit `7379a1f`）：

1. **新增 `deploy/edge/`**：独立 compose 编排（项目名 `edge`，容器 `edge-nginx`，
   nginx:alpine）+ 逐行教学注释的 `nginx.conf`。它独占 `0.0.0.0:80`，挂载
   pick-radar 的 Docker 网络（`external: pick-radar-prod_default`；ai-kb-app
   本来就挂在这个网上，所以网关两边都够得着）。resolver + 变量式 `proxy_pass`
   的写法与坑见 `deploy/edge/nginx.conf` 内注释。
2. **pick-radar 的 `docker-compose.prod.yml` 删掉 web 的 `ports: 80:80`**：web 退到
   Docker 内网。关键细节——**Mac 上的源码同步改了**（不是只在服务器上改），
   它以后 rsync 过来的就是"无 ports"版本，服务器与本机不再分叉。
3. **旧文件三件套备份到 `/opt/ai-kb-assistant/backups/`**（rsync 永远碰不到知识库
   目录，放这里最安全）：改前 compose、被覆盖后的 nginx.conf、deploy.sh。

**切换过程**（灰度先行，全程停机窗口只有几秒）：

```bash
# 1) 灰度：先把 edge 以临时端口（8080）起起来，不动线上 80，逐条 curl 验证
#    /、/kb/、/kb、/kb/api/health、/api/health 全部符合预期后，还原配置
# 2) 备份三件套到 /opt/ai-kb-assistant/backups/（见上）
# 3) 换 pick-radar 的 compose（服务器上先改，Mac 源码随后同步）
cd /opt/pick-radar && sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
#    web 容器重建为"仅内网"版本，80 此刻空出来（外网短暂打不开）
# 4) edge 正式接管 80
sudo docker compose -f /opt/ai-kb-assistant/deploy/edge/docker-compose.yml up -d
```

**验证（2026-10-12 16:22，全绿）**：

```
docker ps:  edge-nginx             0.0.0.0:80->80/tcp   Up   （80 归它独占）
            pick-radar-prod-web-1  80/tcp（仅内网）
            ai-kb-app              3001/tcp（仅内网）

本机 curl:  /               → 200（pick-radar 首页无恙）
            /kb/            → 200
            /kb             → 308 → /kb/
            /kb/api/health  → {"code":0,"data":{"status":"up",...}}

外网 + 浏览器：登录、SSE 流式回答逐字到达（证明网关的 proxy_buffering off 生效）、
上传入库正常。pick-radar 的 deploy.sh 健康检查 curl 127.0.0.1/api/health
走的也是 edge → web → api 这条链路，照样通过——它的上线流程一个字都不用改。
```

**回滚 runbook（想退回旧架构时照做）**：

```bash
# 1) 停边缘网关，80 空出来
sudo docker compose -f /opt/ai-kb-assistant/deploy/edge/docker-compose.yml down
# 2) 用备份恢复 pick-radar 的 compose（web 的 ports: 80:80 回来）
sudo cp /opt/ai-kb-assistant/backups/pick-radar-docker-compose.prod.yml.20261012-pre-edge \
        /opt/pick-radar/docker-compose.prod.yml
cd /opt/pick-radar && sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
# 3) 把 §3.5 的 /kb/ 路由块重新插回 /opt/pick-radar/deploy/nginx.conf 并重建 web
#    （提醒：那条老路会再次被 pick-radar 的下一次 rsync 覆盖——这正是换架构的原因）
```

**今后 pick-radar 更新时要检查什么？——什么都不用**。这正是解耦的意义：它的
rsync 只覆盖它自己的目录，edge 的配置在本仓库由 git 管。最多顺手
`sudo docker ps | grep edge` 确认网关活着。

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

# 边缘网关（全站 80 入口；编排与配置在本仓库 deploy/edge/，详见 §3.7）
sudo docker compose -f /opt/ai-kb-assistant/deploy/edge/docker-compose.yml ps
sudo docker compose -f /opt/ai-kb-assistant/deploy/edge/docker-compose.yml logs -f nginx
sudo docker restart edge-nginx   # 改了 nginx.conf 后执行（配置是挂载进容器的）

# 服务器整体状态（内存/磁盘）
free -h && df -h /
```

**更新代码到最新版本**（git push 之后，在服务器上）：

```bash
cd /opt/ai-kb-assistant
sudo git pull
sudo docker compose up -d --build        # 只重建有变化的层，数据库卷不动
# 若这次改动涉及 deploy/edge/（边缘网关），再补一句：
sudo docker compose -f deploy/edge/docker-compose.yml up -d
```

**完全卸载本项目**（不影响 pick-radar）：

```bash
cd /opt/ai-kb-assistant
sudo docker compose down                  # 停容器+删容器，保留数据卷
# sudo docker compose down -v             # 加上 -v 连数据库一起删（不可恢复！）
sudo docker compose -f deploy/edge/docker-compose.yml down   # 停 80 入口（全站短暂不可达）
# 再按 backups/ 的备份恢复 pick-radar 的 compose（web 加回 ports: 80:80）并 up -d，
# 就回到本项目部署之前的样子——完整步骤见 §3.7 回滚 runbook
```

## 5. 回滚方案

| 场景 | 操作 |
|---|---|
| /kb/ 打不开，pick-radar 正常 | 先看 `sudo docker logs --tail 50 ai-kb-app`，容器挂了 `sudo docker compose -f /opt/ai-kb-assistant/docker-compose.yml restart`；容器正常再查 edge 日志 |
| 全站（`/` 和 `/kb/`）都 502 | edge-nginx 出问题：`sudo docker ps \| grep edge` 看是否在跑——没跑就 `sudo docker compose -f /opt/ai-kb-assistant/deploy/edge/docker-compose.yml up -d`；在跑就 `sudo docker logs --tail 50 edge-nginx` 看转发到哪个后端失败 |
| 新版本部署后有问题 | `cd /opt/ai-kb-assistant && sudo git checkout 上一个commit && sudo docker compose up -d --build` |
| 想整体退回「共用 pick-radar nginx」的旧架构 | 照 §3.7 末尾的回滚 runbook 做（旧文件备份都在 `/opt/ai-kb-assistant/backups/`） |

## 6. FAQ

**Q：怎么改管理员密码？**
A：目前没有改密接口，最简办法：登录后调注册接口新建一个管理员账号使用（或联系开发者加改密功能）。

**Q：上传文档有什么限制？**
A：仅支持 `.pdf / .md / .markdown / .txt`，单个最大 **10MB**（应用层 `MAX_FILE_SIZE_MB` 控制，默认 10；边缘网关 nginx 层放宽到 20m，不构成瓶颈）。

**Q：对话响应慢/报错？**
A：`sudo docker logs --tail 50 ai-kb-app` 看错误。常见原因：Qwen Key 欠费/失效（日志会有 401）、服务器内存不足（`free -h` 看 swap 是否用满）。

**Q：如何撤销部署用的 SSH 密钥？**
A：见 §3.4 最后一行说明，删 authorized_keys 里对应那行即可。

**Q：数据库里的数据存在哪？**
A：Docker 卷 `ai-kb_pgdata`。`sudo docker volume inspect ai-kb_pgdata` 可查实际目录。备份：把该卷目录 tar 打包，或 `sudo docker exec ai-kb-pg pg_dump -U kba knowledge_base > backup.sql`。
