# LawOffice OS — Dependency register and compatibility verification

Verification date: 10 November 2026  
Status: Verified compatible baseline for Milestone M0 (Task T01)  
Canonical package manager: `npm` (single lockfile: `package-lock.json`)

---

## 1. Runtime and environment baseline

| Component | Target / Status | Active runtime in environment | Rationale & documentation source |
|---|---|---|---|
| **Node.js** | Node.js 26 (Lithium) Active LTS | `v26.13.0` | Node.js 26 transitioned to Active LTS on October 28, 2026 (EOL April 30, 2029). Node.js 24 and 22 are in Maintenance LTS. Source: [Node.js Releases](https://nodejs.org/en/about/previous-releases). |
| **npm** | npm 11.x | `11.20.0` | Default package manager bundled with Node.js 26. Exactly one lockfile (`package-lock.json`) is maintained. |
| **Operating System** | Windows / Linux (Docker) | Windows 10/11 / PowerShell | Cross-platform compatibility verified for local development and containerized deployment. |

---

## 2. Core compatibility analysis and constraints

### 2.1 Prisma 7 vs. Prisma 8 and Better Auth compatibility constraint

- **Constraint check date:** 10 November 2026.
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

## 3. Pinned scaffold packages (installed in T01)

These packages provide the minimum foundation for building, linting, typechecking, and serving the Arabic project placeholder (`lang="ar-EG"`, `dir="rtl"`). No application feature modules or database connections are active in T01.

| Package | Pinned version | Type | Purpose & verification source |
|---|---|---|---|
| `next` | `16.4.6` | `dependency` | Web framework with React Server Components & App Router. Requires Node `>=20.9.0`. Source: [Next.js Docs](https://nextjs.org/docs). |
| `react` | `19.3.1` | `dependency` | Core UI library. Peer dependency for Next.js 16. Source: [React Docs](https://react.dev). |
| `react-dom` | `19.3.1` | `dependency` | React DOM renderer. Source: [React Docs](https://react.dev). |
| `typescript` | `5.8.3` | `devDependency` | Static typing in strict mode. Selected for compatibility with `typescript-eslint@8.56.0` (`>=4.8.4 <6.0.0`). Source: [TypeScript Docs](https://www.typescriptlang.org). |
| `@types/node` | `26.6.6` | `devDependency` | Type definitions matching Node.js 26 LTS. Source: [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped). |
| `@types/react` | `19.3.0` | `devDependency` | Type definitions matching React 19.3. Source: [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped). |
| `@types/react-dom` | `19.3.0` | `devDependency` | Type definitions matching React DOM 19.3. Source: [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped). |
| `tailwindcss` | `4.3.5` | `devDependency` | Utility-first styling framework supporting RTL layout and CSS tokens. Source: [Tailwind CSS Docs](https://tailwindcss.com/docs). |
| `@tailwindcss/postcss` | `4.3.5` | `devDependency` | PostCSS plugin for Tailwind CSS v4 integration with Next.js. |
| `postcss` | `8.5.23` | `devDependency` | CSS transformation pipeline required by Tailwind. |
| `eslint` | `9.39.5` | `devDependency` | Linter engine (ESLint 9 LTS/maintenance line). Compatible with `eslint-config-next`. Source: [ESLint Docs](https://eslint.org). |
| `eslint-config-next` | `16.4.6` | `devDependency` | Official Next.js ESLint configuration ruleset (native flat-config arrays `nextVitals` and `nextTypescript`). |

---

## 4. Planned later-task dependencies (Milestones M0–M8)

These dependencies are verified for compatibility with the T01 foundation and will be introduced in their respective assigned task cards. They are **not** installed in T01 to keep the scaffold minimal and free of unapproved modules.

| Domain / Milestone | Package | Target version | Assigned task | Notes & compatibility status |
|---|---|---|---|---|
| **Database / ORM** | `prisma` | `7.10.1` | T02 | Pinned Prisma 7 CLI. |
| **Database / ORM** | `@prisma/client` | `7.10.1` | T02 | Pinned Prisma 7 Client. |
| **Database / ORM** | `@prisma/adapter-pg` | `7.10.1` | T02 | Driver adapter for PostgreSQL pooling. |
| **Database / ORM** | `pg` | `8.23.1` | T02 | Node PostgreSQL client driver. |
| **Database / ORM** | `@types/pg` | `8.23.1` | T02 | Type definitions for `pg`. |
| **Authentication** | `better-auth` | `1.7.20` | T03 | Session management, password hashing, TOTP MFA, recovery codes. Compatible with Next.js 16 and React 19. |
| **Authentication** | `@better-auth/prisma-adapter` | `1.7.20` | T03 | Verified compatible with Prisma 7.10.1. |
| **Validation** | `zod` | `4.6.7` | T02/T03 | Schema validation at Module Interfaces and Server Actions. |
| **Unit/Integration Tests** | `vitest` | `5.1.0` | T02 | Fast unit and integration test runner for business rules and transactions. |
| **E2E & PDF Printing** | `@playwright/test` | `1.65.0` | T02 / T15b | Headless browser testing and server-side Arabic PDF generation. Source: [Playwright Docs](https://playwright.dev). |
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

# 4. Production build
npm run build
```
