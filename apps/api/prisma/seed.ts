import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: 'demo-tenant' },
    update: {},
    create: {
      id: 'demo-tenant',
      name: 'DispatchOS Demo Heating',
      settings: {
        create: {
          businessName: 'DispatchOS Demo Heating',
          businessPhone: '+41225550999',
          escalationPhone: '+41225550123',
          callbackSlaMinutes: 30,
          languages: ['fr', 'en'],
          enabled: true,
          calendarEnabled: false,
        },
      },
    },
  });

  console.log(`Seeded tenant ${tenant.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
