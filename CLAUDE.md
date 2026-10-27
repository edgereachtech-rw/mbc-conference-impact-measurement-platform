# ITTEC Conference Impact Measurement Platform

Platform that follows each ITTEC 2026 delegate from pre-conference baseline through the conference,
Transfer Planning and 30/60/90/180-day follow-ups. First pilot: ITTEC 2026, November 12-13, 2026,
Lagos Oriental Hotel, Victoria Island, Lagos, Nigeria (hybrid: physical and virtual).
Production go-live: November 7, 2026. Built for reuse by future M.Bryan events.

Source of truth: docs/backlog.md (stories, acceptance criteria, question bank) and the workplan in docs/.
When the two disagree, stop and list the conflict instead of guessing.

## Stack (do not substitute)
- TypeScript everywhere, Node.js LTS, pnpm workspaces
- apps/web: Next.js (App Router), Tailwind CSS, shadcn/ui, React Hook Form, PWA manifest
- apps/api: Express.js REST API under /api/v1, Zod validation, Prisma ORM
- apps/worker: job runner using pg-boss (queue on PostgreSQL), same codebase/image as api
- packages/shared: Zod schemas, types, question/scoring/status definitions shared by web and api
- PostgreSQL 16, MinIO (S3-compatible storage), SMTP relay via Nodemailer, Caddy reverse proxy
- Docker Compose deployment on a single VPS. Only Caddy publishes ports.

## Rules
- Mobile-first. Delegates use phones. Test at 360px width first.
- Validate on the server with Zod. Never trust the client.
- Every record belongs to an event (event_id). No ITTEC-specific constants in code; put them in the database.
- Questions are data, versioned. Responses store the question version answered.
- Authorisation is enforced on the server for every route. Delegates see only their own records.
- Never log personal data. Never commit secrets. Provide .env.example only.
- Times are stored in UTC. The event timezone is Africa/Lagos (WAT, UTC+1).
- Pin Docker image tags to exact versions. Never use :latest.
- Write tests with the feature (Vitest). Run lint, type-check and tests before saying a task is done.
- Small commits with clear messages. Do not refactor unrelated code.

## Commands (keep this section current)
- pnpm install | pnpm dev | pnpm build | pnpm lint | pnpm typecheck | pnpm test
- docker compose -f deploy/docker-compose.yml up -d

## Definition of done
Works on a phone, validated on the server, access rules tested, migration applies cleanly,
deployed to staging, documented in the README or docs/.