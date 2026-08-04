import { PrismaClient } from '@prisma/client';
import { config } from '../config.js';

process.env.DATABASE_URL ??= config.DATABASE_URL;

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
