import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { DEMO_ACCOUNT } from '@klyvo/shared';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_ACCOUNT.password, 12);
  const demo = await prisma.user.upsert({
    where: { email: DEMO_ACCOUNT.email },
    update: { passwordHash, displayName: 'Alex Morgan', language: 'ru' },
    create: {
      email: DEMO_ACCOUNT.email,
      passwordHash,
      displayName: 'Alex Morgan',
      language: 'ru',
      wallet: { create: { balance: 420 } },
      creditTransactions: {
        create: [
          {
            type: 'BONUS',
            amount: 100,
            balanceBefore: 0,
            balanceAfter: 100,
            description: 'Welcome credits',
          },
          {
            type: 'PURCHASE',
            amount: 350,
            balanceBefore: 100,
            balanceAfter: 450,
            description: 'Studio credit pack',
          },
          {
            type: 'CHARGE',
            amount: -30,
            balanceBefore: 450,
            balanceAfter: 420,
            description: 'Previous generations',
          },
        ],
      },
    },
    include: { wallet: true },
  });

  if (!demo.wallet) await prisma.creditWallet.create({ data: { userId: demo.id, balance: 420 } });

  // Демонстрационные ролики больше не создаются: в ленте должны быть только настоящие
  // видео пользователей. Ранее засеянные записи удаляет `pnpm db:remove-demo`.

  await prisma.appConfig.upsert({
    where: { key: 'local_mode' },
    update: { value: 'true' },
    create: { key: 'local_mode', value: 'true' },
  });

  console.info(`Seed complete. Demo login: ${DEMO_ACCOUNT.email} / ${DEMO_ACCOUNT.password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
