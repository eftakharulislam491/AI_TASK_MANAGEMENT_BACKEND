# Backend SQA Report

Date: 2026-07-06  
Scope: `backend/` only

## Executive Summary

The backend is in a runnable state after fixing the RAG module dependency injection issue. Static checks, build, unit test, Prisma validation, migration status, and a Nest startup smoke test all passed.

The project now supports authentication, organization tenancy, users/profiles/abilities, teams, projects, tasks, comments, attachments metadata, activity logs, notifications, email invitations, RAG ingestion/query, Redis-backed RAG caching, and scheduled deadline/overdue/digest jobs.

## Issues Fixed During This Review

1. `RAGModule` could not resolve `JwtAuthGuard` dependencies.
   - Root cause: `RAGController` uses `JwtAuthGuard`, but `RAGModule` did not import `AuthModule`.
   - Fix: Added `AuthModule` to `RAGModule` imports.
   - File: `src/rag/rag.module.ts`

2. Nest 11 emitted a legacy wildcard route warning for middleware.
   - Root cause: `forRoutes('*')` is the old unnamed wildcard syntax.
   - Fix: Replaced it with `forRoutes('{*path}')`.
   - File: `src/app.module.ts`

3. Redis offline logs were blank.
   - Root cause: Redis connection errors can be `AggregateError` with useful nested messages.
   - Fix: Added structured error formatting for Redis warnings.
   - File: `src/common/services/redis.service.ts`

## Verification Results

| Check | Result | Notes |
| --- | --- | --- |
| `npm.cmd exec tsc -- --noEmit` | Passed | TypeScript compile check clean |
| `npm.cmd run lint` | Passed | ESLint completed with auto-fix |
| `npm.cmd run build` | Passed | Nest production build completed |
| `npm.cmd test -- --runInBand` | Passed | 1 existing test suite passed |
| `npx.cmd prisma validate` | Passed | Prisma schema is valid |
| `npx.cmd prisma migrate status` | Passed | Configured DB schema is up to date |
| Startup smoke, `PORT=5010 npm.cmd run start` | Passed | App started successfully; command timed out only because server kept running |

## Runtime Notes

- `PORT=5000` was already in use on the machine during the first startup test. The backend itself booted successfully on `PORT=5010`.
- Redis is not running locally at `localhost:6379`. This is acceptable because the Redis service degrades gracefully and RAG still works without cache.
- RAG endpoints require `OPENROUTER_API_KEY` before ingestion/query can work with real embeddings and LLM answers.
- SMTP env values are required before real emails are delivered. Without SMTP, mail methods intentionally log once and skip sending.

## What The Backend Can Do

- Register/login/refresh/logout users with JWT and cookies.
- Support organization-owned users, memberships, join requests, and role change requests.
- Enforce tenant access using `x-organization-id`, route/query org context, or current organization.
- Manage teams and team members.
- Manage projects and project members.
- Manage tasks with assignee, reporter, status, priority, deadline, tags, estimated hours, and filters.
- Record activity timeline entries for task/project/team actions.
- Add comments to tasks.
- Register attachment metadata for tasks, comments, and projects.
- Send EJS/nodemailer emails for invitations, task assignment, deadline reminders, overdue alerts, and daily digest.
- Create/list/read notifications and emit real-time notifications over Socket.IO.
- Ingest task/project data into pgvector document embeddings.
- Query RAG answers from indexed task/project context.
- Cache RAG query answers in Redis with graceful fallback.
- Run scheduled jobs for 24h/48h deadline reminders, overdue alerts, and 9 AM daily digests.

## Current Quality Assessment

Overall status: Good for a course/project backend and close to production shape, but not fully production-complete until external-service integration and deeper tests are added.

Architecture is consistent:
- Modules import the dependencies they use.
- Auth/tenant guards are applied consistently to protected domain controllers.
- Prisma access is mostly typed and scoped.
- Raw SQL is limited to valid cases: health checks, pgvector operations, document embedding upsert/soft-delete, and JSON metadata notification dedupe.
- Mail uses EJS templates and degrades gracefully when SMTP is missing.
- Redis and SMTP failures do not crash normal HTTP flow.

## Remaining Risks / Issues

1. Test coverage is very low.
   - Only 1 Jest suite exists.
   - Need service/controller tests for auth, teams, projects, tasks, notifications, invitations, RAG, Redis fallback, and scheduler dedupe.

2. RAG cannot be fully verified without a real `OPENROUTER_API_KEY`.
   - The code validates API responses and embedding dimension, but real provider behavior must be tested.
   - If the configured embedding model does not return 1536 dimensions, ingestion will fail by design.

3. Redis cache keys include the query text.
   - This works, but for stricter production privacy a hash-based key would be better.
   - Current key is tenant-scoped, so cross-organization leakage is avoided.

4. Scheduled jobs depend on notification metadata for dedupe.
   - This is working logically, but needs integration tests with real tasks and notifications.
   - If old notifications are deleted, scheduler may resend reminders.

5. Daily digest currently sends active task summaries to users with active tasks.
   - This matches the high-level task requirement.
   - If you want a stricter digest, filter to overdue and due-today tasks only.

6. `docker-compose.dev.yml` is mentioned in `task.md` under Macro 3 at project root.
   - This review was backend-only, so root-level compose was not created here.

7. Dependency audit reported vulnerabilities after package install.
   - `npm install` reported 11 vulnerabilities.
   - Run and review `npm audit` before deployment.

## Recommended Next Work

1. Add integration tests using a test database for auth, tenancy, task lifecycle, invitations, notifications, and scheduler jobs.
2. Add mocked OpenRouter tests for embedding and LLM services.
3. Add Redis tests for cache hit, cache miss, and Redis-offline fallback.
4. Add a Docker dev stack for Postgres, pgvector, and Redis if root-level changes are allowed.
5. Add request/response API documentation, preferably OpenAPI/Swagger.
6. Add production observability: request IDs, structured logs, metrics, and error tracking.
7. Review dependency audit results and upgrade vulnerable packages where safe.

## Final Verdict

Everything in `backend/` now builds and starts successfully after the fixes above. The backend makes sense logically and should run smoothly with correct `.env` values, an available database, optional Redis, SMTP credentials for mail, and OpenRouter credentials for RAG.
