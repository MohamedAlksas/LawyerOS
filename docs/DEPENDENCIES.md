# LawOffice OS — Dependency register and compatibility verification

Verification date: 11 November 2026  
Status: Verified compatible baseline for Milestone M0 (Task T01 and Task T02)  
Canonical package manager: `npm` (single lockfile: `package-lock.json`)

---

## 1. Runtime and environment baseline

| Component | Target / Status | Active runtime in environment | Rationale & documentation source |
|---|---|---|---|
| **Node.js** | Node.js 26 (Lithium) Active LTS | `v26.13.0` | Node.js 26 transitioned to Active LTS on October 28, 2026 (EOL April 30, 2029). Node.js 24 and 22 are in Maintenance LTS. Source: [Node.js Releases](https://nodejs.org/en/about/previous-releases). |
| **npm** | npm 11.x | `11.20.0` | Default package manager bundled with Node.js 26. Exactly one lockfile (`package-lock.json`) is maintained. |
| **Operating System** | Windows (Local) / Linux (CI & Docker) | Windows 10/11 / PowerShell (Local); Ubuntu Linux (CI) | Local development and quality checks verified on Windows. Linux container service dependencies verified in GitHub Actions CI (`.github/workflows/ci.yml`). Production Linux host container deployment was NOT RUN on local development machine. |

---

## 2. Core compatibility analysis and constraints

### 2.1 Prisma 7 vs. Prisma 8 and Better Auth compatibility constraint

- **Constraint check date:** 10 November 2026 (re-verified 11 November 2026).
- **Better Auth Prisma adapter requirements:** `@better-auth/prisma-adapter@1.7.20` explicitly declares peer dependencies:
  ```json
  {
    "prisma": "^5.0.0 || ^6.0.0 || ^7.0.0",
    "@prisma/client": "^5.0.0 || ^6.0.0 || ^7.0.0"
  }
  ```
- **Prisma 8 status & breaking changes:**
  - Prisma 8 (`8.0.0-rc.33` / `8.0.0`) introduces major architectural shifts: contract-first `db.orm` runtime, query structures such as `.limit()` / `.offset()` replacing `.take()` / `.skip()`, multi-file schema changes, and peer dependency conflicts with `@better-auth/prisma-adapter`.
  - Upstream Better Auth tracking (e.g. Issue #11077) confirms that `@better-auth/prisma-adapter` does not support Prisma 8 out-of-the-box, resulting in `ERESOLVE` peer dependency failures and runtime query mismatches.
- **Architectural decision:**
  In strict accordance with `docs/ARCHITECTURE.md` Section 1:
  > *"Better Auth's Prisma adapter documentation stated support for Prisma 7 and no support for the Prisma 8 interface at review time. M0 therefore pins compatible CLI, Client, and driver adapter major versions rather than blindly using latest."*
  We pin the **Prisma 7** series:
  - CLI: `prisma@7.10.1`
  - Client: `@prisma/client@7.10.1`
  - PostgreSQL Driver Adapter: `@prisma/adapter-pg@7.10.1`
  - PostgreSQL Client: `pg@8.23.1`, `@types/pg@8.23.1`
- **Documentation sources:**
  - [Better Auth Prisma Adapter](https://better-auth.com/docs/adapters/prisma)
  - [Better Auth 2FA Plugin](https://better-auth.com/docs/plugins/2fa)
  - [Prisma PostgreSQL Driver Adapter](https://www.prisma.io/docs/orm/overview/databases/postgresql)

---

## 3. Pinned scaffold packages (installed in T01 and T02)

These packages provide the minimum foundation for building, linting, typechecking, serving the Arabic project placeholder (`lang="ar-EG"`, `dir="rtl"`), environment schema validation, local database connection pooling, and health probes. No business domain models or authentication sessions are active in T02.

| Package | Pinned version | Type | Purpose & verification source |
|---|---|---|---|
| `next` | `16.4.6` | `dependency` | Web framework with React Server Components & App Router. Requires Node `>=20.9.0`. Source: [Next.js Docs](https://nextjs.org/docs). |
| `react` | `19.3.1` | `dependency` | Core UI library. Peer dependency for Next.js 16. Source: [React Docs](https://react.dev). |
| `react-dom` | `19.3.1` | `dependency` | React DOM renderer. Source: [React Docs](https://react.dev). |
| `zod` | `4.6.7` | `dependency` | Schema validation at server environment boundary (`src/lib/env.ts`) and future module commands. Pinned exact. Source: [Zod Docs](https://zod.dev). |
| `pg` | `8.23.1` | `dependency` | Node PostgreSQL connection pooling driver for database readiness probes and server queries. Source: [node-postgres Docs](https://node-postgres.com). |
| `@prisma/client` | `7.10.1` | `dependency` | Prisma 7 Client. Pinned exact for Better Auth compatibility. |
| `@prisma/adapter-pg` | `7.10.1` | `dependency` | PostgreSQL driver adapter for Prisma 7 connection pooling. |
| `typescript` | `5.8.3` | `devDependency` | Static typing in strict mode. Selected for compatibility with `typescript-eslint@8.72.2` (`>=4.8.4 <6.0.0`). Source: [TypeScript Docs](https://www.typescriptlang.org). |
| `@types/node` | `26.6.6` | `devDependency` | Type definitions matching Node.js 26 LTS. Source: [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped). |
| `@types/react` | `19.3.0` | `devDependency` | Type definitions matching React 19.3. Source: [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped). |
| `@types/react-dom` | `19.3.0` | `devDependency` | Type definitions matching React DOM 19.3. Source: [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped). |
| `@types/pg` | `8.23.1` | `devDependency` | Type definitions matching `pg@8.23.1`. |
| `prisma` | `7.10.1` | `devDependency` | Prisma 7 CLI for migration and schema management. Pinned exact. |
| `vitest` | `5.1.0` | `devDependency` | Fast unit and integration test runner for Node environment and health checks. Source: [Vitest Docs](https://vitest.dev). |
| `tailwindcss` | `4.3.5` | `devDependency` | Utility-first styling framework supporting RTL layout and CSS tokens. Source: [Tailwind CSS Docs](https://tailwindcss.com/docs). |
| `@tailwindcss/postcss` | `4.3.5` | `devDependency` | PostCSS plugin for Tailwind CSS v4 integration with Next.js. |
| `postcss` | `8.5.23` | `devDependency` | CSS transformation pipeline required by Tailwind. |
| `eslint` | `9.39.5` | `devDependency` | Linter engine. Note: npm displays an unsupported maintenance notice for `eslint@9.39.5`, but its selected Next.js peer requirement is satisfied and linting passes cleanly with 0 errors. Source: [ESLint Docs](https://eslint.org). |
| `eslint-config-next` | `16.4.6` | `devDependency` | Official Next.js ESLint configuration ruleset (native flat-config arrays `nextVitals` and `nextTypescript`). |

---

## 4. Planned later-task dependencies (Milestones M1–M8)

These dependencies are verified for compatibility with the T01/T02 foundation and will be introduced in their respective assigned task cards. They are **not** installed in T02 to keep the runtime minimal and free of unapproved modules.

| Domain / Milestone | Package | Target version | Assigned task | Notes & compatibility status |
|---|---|---|---|---|
| **Authentication** | `better-auth` | `1.7.20` | T03 | Session management, password hashing, TOTP MFA, recovery codes. Compatible with Next.js 16 and React 19. |
| **Authentication** | `@better-auth/prisma-adapter` | `1.7.20` | T03 | Verified compatible with Prisma 7.10.1. |
| **E2E Browser Testing** | `@playwright/test` | `1.65.0` | T04 | Headless browser testing for operational journeys (M1+). Source: [Playwright Docs](https://playwright.dev). |
| **Arabic PDF Printing** | `@playwright/test` | `1.65.0` | T16 | Server-side Arabic PDF document compilation. |
| **Icons** | `lucide-react` | `1.16.0` | T04 | UI icons adaptable for RTL direction. |

---

## 5. Verification commands and reproducibility

To reproduce a clean installation and verify the toolchain:

```powershell
# 1. Clean installation from lockfile
npm ci

# 2. Linting
npm run lint

# 3. Strict TypeScript typechecking
npm run typecheck

# 4. Unit tests
npm run test

# 5. Integration tests (database readiness & timeouts)
npm run test:integration

# 6. Production build
npm run build
```
