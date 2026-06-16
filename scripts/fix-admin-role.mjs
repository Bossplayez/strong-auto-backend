import { PrismaClient } from '@prisma/client';

const p = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://postgres:HOelOkvEMRECXEugwnzdjzcIovyQNPFf@trolley.proxy.rlwy.net:19999/railway'
    }
  }
});

// Check current state
const before = await p.user.findFirst({ where: { email: 'admin@strongauto.com' } });
console.log('Before:', before?.email, before?.userType, before?.status);

// Update to ADMIN
await p.user.updateMany({
  where: { email: 'admin@strongauto.com' },
  data: { userType: 'ADMIN' }
});

// Verify
const after = await p.user.findFirst({ where: { email: 'admin@strongauto.com' } });
console.log('After:', after?.email, after?.userType, after?.status);

// Count vehicles
const count = await p.vehicle.count();
console.log('Vehicles in DB:', count);

await p.$disconnect();
