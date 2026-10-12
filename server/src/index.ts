// ===== HTTP 启动入口：后端进程的第一个文件 =====
// 职责只有一件事：把各部分按正确顺序拉起来——检查关键配置 → 初始化数据库 →
// 组装 Express 应用 → 监听端口开始收请求，业务逻辑一概不写在里面。
// 协作方：config.ts（读配置）、db/（建库建表）、app.ts（组装应用）
import { createApp } from './app';
import { config } from './config';
import { initDb } from './db';
import { ensureSeedUsers } from './services/auth';

async function main() {
  // JWT 密钥是登录令牌的"签名印章"，缺了它任何人都能伪造 token。
  // 宁可现在就报错退出，也不带病上线让整套登录形同虚设
  if (!config.jwt.secret) {
    console.error('启动失败: 缺少 JWT_SECRET，请在 server/.env 中配置');
    process.exit(1);
  }
  // 顺序有讲究：先建表（initDb）、再补种子账号，最后才开端口收请求。
  // 反过来的话端口先开，最早进来的请求会撞上还没准备好的数据库
  await initDb();
  // 首次启动写入默认账号，已存在则跳过，所以重复重启没有副作用
  await ensureSeedUsers();
  const app = createApp();
  // listen 后进程正式对外服务；端口来自 config（环境变量 PORT，默认 3001）
  app.listen(config.port, () => {
    console.log(`BFF 已启动: http://localhost:${config.port}/api/health`);
  });
}

// main 是 async 函数，里面任何一步抛错都只会变成没人接的 rejected Promise，
// 进程表面还活着、实际什么都没干。这里统一接住：打日志并以非 0 退出码结束，
// 让 docker / pm2 这类守护工具能感知"启动失败"并告警或重启
main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
