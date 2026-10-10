import { createApp } from './app';
import { config } from './config';
import { initDb } from './db';
import { ensureSeedUsers } from './services/auth';

async function main() {
  if (!config.jwt.secret) {
    console.error('启动失败: 缺少 JWT_SECRET，请在 server/.env 中配置');
    process.exit(1);
  }
  await initDb();
  await ensureSeedUsers();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`BFF 已启动: http://localhost:${config.port}/api/health`);
  });
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
