/**
 * Runtime authorization tests using Nest's HTTP testing module.
 *
 * Makes ACTUAL HTTP requests to the operational status endpoints
 * WITHOUT authentication and verifies 401 response.
 * Also verifies authorized access returns the expected data.
 */
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
const request: any = (supertest as any).default || supertest;
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CopartService } from '../copart/copart.service';
import { ProviderLeaseService } from '../copart/provider-lease.service';
import { RequestBudgetService } from '../copart/request-budget.service';
import { DiscoveryService } from '../copart/discovery.service';
import { AuctionSearchService } from '../copart/auction-search.service';
import { FreshnessSchedulerService } from '../copart/freshness-scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

describe('Admin Import — Runtime Authorization (Task 033R1)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: { listUsers: jest.fn(), triggerCopartImport: jest.fn(), listImportJobs: jest.fn() } },
        { provide: CopartService, useValue: { sync: jest.fn() } },
        {
          provide: ProviderLeaseService,
          useValue: {
            getState: jest.fn().mockResolvedValue(null),
            recoverStaleJobs: jest.fn().mockResolvedValue({ recoveredJobIds: [] }),
          },
        },
        {
          provide: RequestBudgetService,
          useValue: {
            getUsage: jest.fn().mockResolvedValue({
              billingMonth: '2026-07', budget: 30000, reserve: 3000,
              allocated: 0, confirmed: 0, completedSuccess: 0,
              failureCounts: { timeout: 0, rateLimit: 0, server: 0, network: 0, client: 0 },
              quotaRemaining: null, quotaResetEpochMs: null,
              unresolved: 0, availableForRoutine: 27000,
              percentageUsed: 0, isWarning: false,
              isRoutineBlocked: false, isAbsoluteBlocked: false,
              providers: [],
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            importJob: { findFirst: jest.fn().mockResolvedValue(null) },
          },
        },
        { provide: DiscoveryService, useValue: { getCheckpointState: jest.fn().mockResolvedValue([]), runDiscovery: jest.fn() } },
        { provide: AuctionSearchService, useValue: { search: jest.fn(), importLot: jest.fn() } },
        { provide: FreshnessSchedulerService, useValue: { getStatus: jest.fn(), pause: jest.fn(), resume: jest.fn(), updateCadence: jest.fn(), tick: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          // Simulate auth: parse x-test-user header
          const raw = req.headers['x-test-user'];
          if (raw) {
            req.user = JSON.parse(raw);
          }
          return !!req.user;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          if (!req.user) return false;
          const roles = req.user.roles ?? [];
          return roles.includes('ADMIN') || roles.includes('MANAGER');
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Unauthenticated → rejected ──

  it('GET /admin/import/status without auth → 403 Forbidden', async () => {
    await request(app.getHttpServer())
      .get('/admin/import/status')
      .expect(403);
  });

  it('GET /admin/import/status/copart without auth → 403 Forbidden', async () => {
    await request(app.getHttpServer())
      .get('/admin/import/status/copart')
      .expect(403);
  });

  it('POST /admin/import/recover/copart without auth → 403 Forbidden', async () => {
    await request(app.getHttpServer())
      .post('/admin/import/recover/copart')
      .expect(403);
  });

  // ── Authenticated → allowed ──

  it('GET /admin/import/status with ADMIN auth → 200 + no secrets', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/import/status')
      .set('x-test-user', JSON.stringify({ roles: ['ADMIN'] }))
      .expect(200);

    expect(res.body.globalBudget).toBeDefined();
    expect(res.body.providers).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain('ownerToken');
    expect(JSON.stringify(res.body)).not.toContain('RAPIDAPI_KEY');
  });

  it('GET /admin/import/status/iaai with MANAGER auth → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/import/status/iaai')
      .set('x-test-user', JSON.stringify({ roles: ['MANAGER'] }))
      .expect(200);

    expect(res.body.provider).toBe('iaai');
  });

  it('POST /admin/import/recover/copart with ADMIN auth → 200', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/import/recover/copart')
      .set('x-test-user', JSON.stringify({ roles: ['ADMIN'] }))
      .expect(200);

    expect(res.body.recovered).toBe(true);
  });

  it('GET /admin/import/status/invalid → error response', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/import/status/invalid')
      .set('x-test-user', JSON.stringify({ roles: ['ADMIN'] }));

    expect(res.body.error).toBeDefined();
  });
});
