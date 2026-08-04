import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const prismaDirectory = resolve(process.cwd(), 'prisma');
const databasePath = resolve(prismaDirectory, 'test.db');

if (!databasePath.startsWith(prismaDirectory)) throw new Error('Unsafe test database path');
await mkdir(prismaDirectory, { recursive: true });
await rm(databasePath, { force: true });
await writeFile(databasePath, '');
