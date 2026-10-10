import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import pretty from 'pino-pretty';
import { config } from '../config';

const level = config.log.level as pino.Level;

const streams: pino.StreamEntry[] = [];

if (process.env.NODE_ENV === 'production') {
  streams.push({ level, stream: process.stdout });
} else {
  streams.push({
    level,
    stream: pretty({
      colorize: true,
      translateTime: 'SYS:HH:MM:ss',
      ignore: 'pid,hostname',
    }),
  });
}

if (config.log.file) {
  fs.mkdirSync(path.resolve(config.log.file, '..'), { recursive: true });
  streams.push({
    level,
    stream: fs.createWriteStream(path.resolve(config.log.file), { flags: 'a' }),
  });
}

export const logger = pino({ level }, pino.multistream(streams));
