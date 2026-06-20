# Strong Auto — Backend API

REST API for the Strong Auto car import platform (USA → Ukraine). Handles authentication, vehicle catalog, Copart auction integration, leads, news, cost calculator, file storage, and admin functionality.

**Live:** https://strong-auto-backend-production.up.railway.app/api/v1
**Swagger docs:** https://strong-auto-backend-production.up.railway.app/api/docs

## Tech Stack

- **Framework:** NestJS 11
- **ORM:** Prisma
- **Database:** PostgreSQL
- **Auth:** JWT (access + refresh tokens)
- **External APIs:** RapidAPI (Copart/IAAI auction data)
- **Storage:** Cloudflare R2
- **Email:** Resend
- **Monitoring:** Sentry

## Requirements

- Node.js 22+
- PostgreSQL 14+

## Getting Started

```bash
# Clone and install
git clone https://github.com/Bossplayez/strong-auto-backend.git
cd strong-auto-backend
npm install --legacy-peer-deps

# Start dev server (http://localhost:3001)
npm run start:dev
```

## Build

```bash
npm run build
npm run start:prod
```

## Prisma

```bash
# Generate Prisma client
npx prisma generate

# Apply migrations in production
npx prisma migrate deploy

# Create a new migration in development
npx prisma migrate dev --name <migration_name>

# Open Prisma Studio
npx prisma studio
```

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT signing secret |
| `RAPIDAPI_KEY` | RapidAPI key (Copart/IAAI data) |
| `SENTRY_DSN` | Sentry DSN |
| `R2_ACCOUNT_ID` | Cloudflare R2 account ID |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 access key |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 secret key |
| `R2_BUCKET_NAME` | Cloudflare R2 bucket name |
| `RESEND_API_KEY` | Resend email API key |

## Module Structure

```
src/
├── auth/           # Authentication & JWT management
├── catalog/        # Vehicle catalog & inventory
├── calculator/     # Import cost calculator
├── copart/         # Copart auction search & import
├── leads/          # Customer inquiries & requests
├── news/           # News articles CRUD
├── files/          # File upload & R2 storage
└── admin/          # Admin panel endpoints
```

## API Documentation

Interactive Swagger UI is available at:

```
/api/docs
```

All API routes are prefixed with `/api/v1`.

## Deployment

Deployed on Railway:

```bash
railway up --detach
```

Railway automatically builds and deploys on push to `main`.

## License

Proprietary — Strong Auto © 2025
