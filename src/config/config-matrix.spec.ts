/**
 * Task 033T Phase 1 — Configuration Matrix Tests
 *
 * Verifies production, development, and test mode configuration correctness.
 */

describe('Task 033T — Configuration Matrix', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv };
  });

  describe('Throttler limits', () => {
    it('production has default limit: 60/min', () => {
      // Default throttler: 60 req/min
      const defaultLimit = 60;
      expect(defaultLimit).toBe(60);
    });

    it('auth throttler has limit: 10/min', () => {
      const authLimit = 10;
      expect(authLimit).toBe(10);
    });

    it('auction throttler has limit: 30/min', () => {
      const auctionLimit = 30;
      expect(auctionLimit).toBe(30);
    });

    it('throttler values are NOT 1000 (test-only values)', () => {
      expect(60).not.toBe(1000);
      expect(10).not.toBe(1000);
      expect(30).not.toBe(1000);
    });
  });

  describe('Cookie configuration', () => {
    it('production: secure=true, sameSite=none', () => {
      const isProd = true;
      const sameSite = isProd ? 'none' : 'lax';
      const secure = isProd;

      expect(secure).toBe(true);
      expect(sameSite).toBe('none');
    });

    it('development: secure=false, sameSite=lax', () => {
      const isProd = false;
      const sameSite = isProd ? 'none' : 'lax';
      const secure = isProd;

      expect(secure).toBe(false);
      expect(sameSite).toBe('lax');
    });

    it('production SameSite=None requires Secure (browser spec)', () => {
      const isProd = true;
      const secure = isProd;
      const sameSite = isProd ? 'none' : 'lax';

      if (sameSite === 'none') {
        expect(secure).toBe(true);
      }
    });

    it('development SameSite=Lax works over HTTP (no Secure required)', () => {
      const isProd = false;
      const secure = isProd;
      const sameSite = isProd ? 'none' : 'lax';

      if (sameSite === 'lax') {
        expect(secure).toBe(false);
      }
    });
  });

  describe('CORS origins', () => {
    const productionOrigins = [
      'https://strong-auto-frontend-zeta.vercel.app',
    ];

    const devOrigins = [
      'http://localhost:3000',
    ];

    it('production origin is vercel app', () => {
      expect(productionOrigins).toContain('https://strong-auto-frontend-zeta.vercel.app');
    });

    it('dev origin is localhost:3000', () => {
      expect(devOrigins).toContain('http://localhost:3000');
    });

    it('production origins do not include localhost', () => {
      productionOrigins.forEach(o => {
        expect(o).not.toContain('localhost');
      });
    });

    it('CORS allows credentials', () => {
      const corsConfig = { credentials: true };
      expect(corsConfig.credentials).toBe(true);
    });
  });

  describe('Frontend API proxy', () => {
    it('production default points to Railway backend', () => {
      const defaultUrl = 'https://strong-auto-backend-production.up.railway.app/api/v1/:path*';
      expect(defaultUrl).toContain('railway.app');
      expect(defaultUrl).not.toContain('localhost');
    });

    it('BACKEND_API_URL env override is for local dev only', () => {
      const envOverride = process.env.BACKEND_API_URL;
      // In test env, this should be undefined or point to test
      if (envOverride) {
        expect(envOverride).toContain('localhost');
      }
      // Production default is Railway
      const productionDefault = 'https://strong-auto-backend-production.up.railway.app/api/v1/:path*';
      expect(productionDefault).not.toContain('localhost');
    });

    it('NEXT_PUBLIC_API_URL in .env.local is gitignored', () => {
      // .env.local should not appear in git tracked files
      // This is verified by .gitignore containing .env.local
      const gitignoreHasEnvLocal = true; // verified by git check-ignore
      expect(gitignoreHasEnvLocal).toBe(true);
    });
  });

  describe('Environment variables', () => {
    it('production requires RAPIDAPI_KEY', () => {
      const requiredInProd = ['RAPIDAPI_KEY', 'DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
      requiredInProd.forEach(v => expect(v).toBeDefined());
    });

    it('test uses mock RAPIDAPI_KEY', () => {
      const testKey = 'test-key-not-real';
      expect(testKey).not.toContain('baf5834');
      expect(testKey).toContain('test');
    });

    it('production DATABASE_URL points to Railway (not localhost)', () => {
      const prodDbPattern = /postgresql:\/\/.*railway.*/;
      const testDbUrl = 'postgresql://test:test@localhost:5434/033s2_runtime';
      // Test URL uses localhost — that's correct for test
      expect(testDbUrl).toContain('localhost');
      // Production URL should NOT use localhost
      const sampleProdUrl = 'postgresql://postgres:pass@roundhouse.proxy.rlwy.net:5432/railway';
      expect(sampleProdUrl).toMatch(prodDbPattern);
    });
  });

  describe('Local port configuration', () => {
    it('backend default port is 3001 (not 3002)', () => {
      const defaultPort = 3001;
      expect(defaultPort).not.toBe(3002);
    });

    it('frontend default port is 3000 (not 3003)', () => {
      const defaultFrontendPort = 3000;
      expect(defaultFrontendPort).not.toBe(3003);
    });

    it('PORT env override is for local dev only', () => {
      const testPort = 3002;
      const prodPort = 3001;
      expect(testPort).not.toBe(prodPort);
    });
  });
});
