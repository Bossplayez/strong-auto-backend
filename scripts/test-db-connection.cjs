// Test script to check DB connection at runtime
const { PrismaClient } = require('@prisma/client');

async function test() {
  console.log('env DATABASE_URL host:', process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'unknown');
  
  const prisma = new PrismaClient();
  const user = await prisma.user.findFirst({
    where: { email: 'admin@strongauto.com' },
    select: { id: true, email: true, userType: true, status: true },
  });
  const count = await prisma.vehicle.count();
  console.log('Actual DB - admin:', user?.userType || 'NOT FOUND', 'count:', count);
  await prisma.$disconnect();
}

test().catch(e => console.error(e));
