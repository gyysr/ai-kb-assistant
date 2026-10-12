// ===== 日志服务：全后端共用的打日志出口（pino 库）=====
// "双通道"：开发环境往控制台输出人类易读的 pretty 格式，同时把 JSON 追加进日志文件；
// 生产环境只输出 JSON 到标准输出，方便日志采集工具统一收集。requestLogger、
// errorHandler 等中间件和各 service 都从这里 import logger。
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { config } from '../config';

const level = config.log.level as pino.Level;

// pino 的"流"（stream）= 一个日志输出目的地，控制台算一个、文件算一个，下面按环境组装
const streams: pino.StreamEntry[] = [];

if (process.env.NODE_ENV === 'production') {
  // 生产走标准输出：容器/服务器由外部采集程序负责收集，应用自己不写文件
  streams.push({ level, stream: process.stdout });
} else {
  // pino-pretty 是 devDependency，生产镜像会 prune 掉，只能按需加载
  // （require 到运行时才真正加载；若写在顶层 import，生产环境一启动就会因找不到包而崩）
  const pretty = require('pino-pretty') as typeof import('pino-pretty');
  streams.push({
    level,
    stream: pretty({
      colorize: true,
      translateTime: 'SYS:HH:MM:ss',
      ignore: 'pid,hostname',
    }),
  });
}

// 第二通道：日志文件（没配 LOG_FILE 就整个跳过）
if (config.log.file) {
  // 先把 logs/ 这类父目录建出来，目录不存在时 createWriteStream 会直接报错
  fs.mkdirSync(path.resolve(config.log.file, '..'), { recursive: true });
  streams.push({
    level,
    // 'a' = 追加模式，服务重启也不会清掉历史日志
    stream: fs.createWriteStream(path.resolve(config.log.file), { flags: 'a' }),
  });
}

// multistream 把上面多个流合并：一条日志会同时送到每一个流（控制台 + 文件）
export const logger = pino({ level }, pino.multistream(streams));
