import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './lib/prisma.js';
import { startGenerationWorker, stopGenerationWorker } from './services/generations.js';

const app = await buildApp();

const shutdown = async () => {
  stopGenerationWorker();
  await app.close();
  await prisma.$disconnect();
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  startGenerationWorker(app.log);
  app.log.info(
    { intervalSeconds: config.GENERATION_POLL_SECONDS },
    'Generation worker started: видео дорабатываются даже при закрытом приложении',
  );
} catch (error) {
  app.log.error(error);
  await shutdown();
  process.exit(1);
}
