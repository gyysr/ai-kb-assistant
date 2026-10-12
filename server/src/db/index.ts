// ===== 连接池：所有 SQL 查询都从这里拿连接 =====
// "池" = 预先建好一堆数据库连接轮流用，省去每次查询都重新握手建立连接
// （一次 TCP 连接 + 密码认证要几十毫秒，查询频繁时开销巨大）。pg 的 Pool 自动
// 管理借出与归还，满了就让后来的排队。全项目 db/*.ts 都 import 这一个 pool。
import { Pool } from 'pg';
import { config } from '../config';
import { SCHEMA_SQL } from './schema';

// 全局唯一连接池，模块首次被 import 时创建（连接按需懒建，不是构造时一次全建）
export const pool = new Pool({ connectionString: config.databaseUrl });

// 服务启动时调用（见 index.ts）：执行 schema.ts 的建表 SQL；
// 语句全是 IF NOT EXISTS，已建过就跳过，重复执行安全
export async function initDb(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}
