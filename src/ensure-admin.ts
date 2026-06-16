import { PrismaClient } from '@prisma/client';

async function ensureAdmin() {
  const prisma = new PrismaClient();
  try {
    const email = 'admin@strongauto.com';
    const existing = await prisma.user.findFirst({ where: { email } });
    if (existing && existing.userType !== 'ADMIN') {
      await prisma.user.update({
        where: { id: existing.id },
        data: { userType: 'ADMIN' },
      });
      console.log(`[ensure-admin] Upgraded ${email} to ADMIN`);
    } else if (existing) {
      console.log(`[ensure-admin] ${email} is already ADMIN`);
    } else {
      console.log(`[ensure-admin] ${email} not found, skipping`);
    }
  } catch (e) {
    console.error('[ensure-admin] Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

ensureAdmin();
