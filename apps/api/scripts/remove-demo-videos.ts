import { PrismaClient } from '@prisma/client';

/**
 * Удаляет только демонстрационные ролики, засеянные прежней версией `db:seed`.
 * Они опознаются по batchId вида `seed-batch-N` и по внешним ссылкам на сэмплы Google.
 * Настоящие пользовательские генерации скрипт не трогает.
 */
const prisma = new PrismaClient();

async function main() {
  const seeded = await prisma.generation.findMany({
    where: {
      OR: [
        { batchId: { startsWith: 'seed-batch-' } },
        { providerTaskId: { startsWith: 'seed-' } },
        { video: { videoUrl: { contains: 'commondatastorage.googleapis.com' } } },
      ],
    },
    include: { video: true },
  });

  if (!seeded.length) {
    console.info('Демонстрационных роликов не найдено — удалять нечего.');
    return;
  }

  for (const generation of seeded) {
    console.info(
      `Удаляю: "${generation.originalPrompt.slice(0, 60)}" (генерация ${generation.id}` +
        `${generation.video ? `, видео ${generation.video.id}` : ''})`,
    );
  }

  const videoIds = seeded
    .map((generation) => generation.video?.id)
    .filter((id): id is string => Boolean(id));

  await prisma.videoPublication.deleteMany({ where: { videoId: { in: videoIds } } });
  await prisma.videoLike.deleteMany({ where: { videoId: { in: videoIds } } });
  await prisma.report.deleteMany({ where: { videoId: { in: videoIds } } });
  await prisma.video.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.creditTransaction.deleteMany({
    where: { generationId: { in: seeded.map(({ id }) => id) } },
  });
  const removed = await prisma.generation.deleteMany({
    where: { id: { in: seeded.map(({ id }) => id) } },
  });

  console.info(`Готово: удалено ${removed.count} демонстрационных генераций.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
