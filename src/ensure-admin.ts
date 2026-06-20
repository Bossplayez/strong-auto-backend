import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

async function ensureAdmin() {
  const prisma = new PrismaClient();
  try {
    const email = 'admin@strongauto.com';
    const password = 'AdminStr0ng!';
    let existing = await prisma.user.findFirst({ where: { email } });
    
    if (!existing) {
      // Create admin user
      const passwordHash = await bcrypt.hash(password, 10);
      existing = await prisma.user.create({
        data: {
          email,
          passwordHash,
          userType: 'ADMIN',
          status: 'ACTIVE',
        },
      });
      console.log(`[ensure-admin] Created admin user: ${email}`);
    } else if (existing.userType !== 'ADMIN') {
      await prisma.user.update({
        where: { id: existing.id },
        data: { userType: 'ADMIN' },
      });
      console.log(`[ensure-admin] Upgraded ${email} to ADMIN`);
    } else {
      console.log(`[ensure-admin] ${email} is already ADMIN`);
    }
    
    // Verify
    const verified = await prisma.user.findFirst({
      where: { email },
      select: { id: true, email: true, userType: true, status: true },
    });
    console.log('[ensure-admin] Verified:', JSON.stringify(verified));
    
    const vehicleCount = await prisma.vehicle.count();
    console.log('[ensure-admin] Vehicle count in this DB:', vehicleCount);
  } catch (e) {
    console.error('[ensure-admin] Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

ensureAdmin();
