# LawOffice OS — Product context

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is the project owner's father: a lawyer in Egypt who works alone, handles varied case types, and currently relies on paper. The project owner is responsible for setting up and maintaining the system; this does not automatically grant access to the contents of every matter.

## Product Purpose

Organize the whole office: clients, internal matter files, court case numbers, hearings, documents, assignments, fees, and expenses. Provide access from desktop and mobile while maintaining links to the paper files.

## Operating Context

The desktop is used to enter files, review accounts, and print. The mobile is used to check today's schedule, record a hearing result, and photograph a document. This is a private office system; opening a client portal or selling subscriptions to other offices is outside the first version.

## Capabilities and Constraints

- Planning documents and implementation instructions are in English. The intended application remains in simple Egyptian Arabic with an RTL interface, with technical terms and codes isolated in LTR direction.
- One matter may involve multiple clients and opponents, as well as multiple court instances and court case numbers.
- Legal deadlines are entered or reviewed by the lawyer; the application does not determine them independently.
- Paper remains in use during the transition, and its location is part of the matter's data.
- Fees, judicial expenses, office expenses, and client money received for future spending are separate accounts.
- The current request assigns planning and review to Codex and implementation to Gemini 3.8 Flash, using the model name specified by the project owner. Model availability, operation, and file access have not been tested.

## Stack

The planning proposal continues the previous conversation: Next.js, TypeScript, PostgreSQL, Prisma, and Docker Compose. Selecting, pinning, and testing compatible versions is an M0 task, before implementing real features. The final hosting choice must be resolved before transferring real data; no deployment or service purchase has taken place.

## Evidence on Hand

The previous conversation, "اقتراحات نظام محاماة" (law office system suggestions), has been reviewed. No actual case files, documents, visual identity, or operating figures have been supplied. Names, amounts, and dataset sizes in the plan are illustrative, and speed targets are estimates that must be measured.

## Product Principles

1. Find all information about the work through its matter file without mixing court instances.
2. Recording a hearing result on mobile matters more than the number of available options.
3. Correct deadlines, accurate accounts, and successful data recovery are actual operating requirements.
4. Migrate paper gradually, starting with upcoming hearings.
5. Any later AI or OCR produces suggestions for review and never automatically changes approved information.

## Open Decisions

The hosting and offsite backup provider and location, archive size, external notification channel and its budget, and actual printers and devices remain open. These decisions do not prevent implementing a trial version with synthetic data.
