import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { performance } from 'perf_hooks';
import { getPrismaClient } from '@/lib/auth';
import { searchMatters, searchProceedings, unifiedSearch } from '@/modules/matters/matter-service';
import { searchParties } from '@/modules/parties/service';
import { createSyntheticActor, setupTestEncryptionKeys } from '../helpers/party-test-helper';

describe('T07 Search Performance Benchmark against PRD NFR-04 (P50, P90, P95 < 2000ms) & NFR-01', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
  let testCourtId: string;

  beforeAll(async () => {
    setupTestEncryptionKeys();

    let court = await prisma.court.findFirst({ where: { isActive: true } });
    if (!court) {
      court = await prisma.court.create({
        data: {
          name: 'محكمة استئناف القاهرة - دوائر تجارية',
          code: 'CAIRO-APP-COMM',
          isActive: true,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
    }
    testCourtId = court.id;

    // Fast SQL bulk insert: Seed 4,000 synthetic casework records
    // (800 parties + 2,000 matters + 1,200 proceedings = 4,000 records, meeting PRD 2,000 Matters target)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "party" ("id", "kind", "name", "nameNormalized", "primaryPhone", "primaryPhoneNormalized", "version", "createdById", "updatedById", "createdAt", "updatedAt")
      SELECT
        'perf-party-' || i,
        CASE WHEN i % 2 = 0 THEN 'PERSON'::"PartyKind" ELSE 'ORGANIZATION'::"PartyKind" END,
        'طرف تجريبي للأداء ' || i || ' شركة الفهد للحلول',
        'طرف تجريبي للاداء ' || i || ' شركه الفهد للحلول',
        '010' || lpad(i::text, 8, '0'),
        '010' || lpad(i::text, 8, '0'),
        1,
        '${actor.id}', '${actor.id}', now(), now()
      FROM generate_series(1, 800) AS s(i);
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "matter" ("id", "fileCode", "title", "titleNormalized", "kind", "status", "version", "createdById", "updatedById", "createdAt", "updatedAt")
      SELECT
        'perf-matter-' || i,
        '2026/P' || lpad(i::text, 5, '0'),
        'قضية أداء المعاملات والبحث ' || i || ' نزاع استثماري تجاري الفهد',
        'قضيه اداء المعاملات والبحث ' || i || ' نزاع استثماري تجاري الفهد',
        'LITIGATION'::"MatterKind",
        CASE WHEN i % 5 = 0 THEN 'ARCHIVED'::"MatterStatus" ELSE 'ACTIVE'::"MatterStatus" END,
        1,
        '${actor.id}', '${actor.id}', now(), now()
      FROM generate_series(1, 2000) AS s(i);
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "proceeding" ("id", "matterId", "courtId", "instance", "registerType", "circuit", "numberText", "numberNormalized", "yearLabel", "yearNormalized", "status", "version", "createdById", "updatedById", "createdAt", "updatedAt")
      SELECT
        'perf-proc-' || i,
        'perf-matter-' || i,
        '${testCourtId}',
        'FIRST_INSTANCE'::"ProceedingInstance",
        'تجاري',
        'الدائرة ' || (i % 20),
        (1000 + i)::text,
        (1000 + i)::text,
        '2026',
        '2026',
        'ACTIVE'::"ProceedingStatus",
        1,
        '${actor.id}', '${actor.id}', now(), now()
      FROM generate_series(1, 1200) AS s(i);
    `);
  }, 60000);

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`
      DELETE FROM "proceeding" WHERE id LIKE 'perf-proc-%';
      DELETE FROM "matter" WHERE id LIKE 'perf-matter-%';
      DELETE FROM "party" WHERE id LIKE 'perf-party-%';
    `);
  });

  function calculatePercentiles(latencies: number[]) {
    latencies.sort((a, b) => a - b);
    const n = latencies.length;
    return {
      min: latencies[0],
      p50: latencies[Math.floor(n * 0.5)],
      p90: latencies[Math.floor(n * 0.9)],
      p95: latencies[Math.floor(n * 0.95)],
      p99: latencies[Math.floor(n * 0.99)],
      max: latencies[n - 1],
      avg: latencies.reduce((s, x) => s + x, 0) / n,
    };
  }

  it('measures Party Search latency distribution (P95 < 500ms)', async () => {
    // Warmup
    await searchParties(actor, { query: 'الفهد', limit: 10 });

    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      const res = await searchParties(actor, { query: 'الفهد', limit: 10 });
      const t1 = performance.now();
      expect(res.parties.length).toBeGreaterThan(0);
      samples.push(t1 - t0);
    }

    const stats = calculatePercentiles(samples);
    console.log(`[PERF BENCHMARK] Party Search: min=${stats.min.toFixed(1)}ms, avg=${stats.avg.toFixed(1)}ms, P50=${stats.p50.toFixed(1)}ms, P90=${stats.p90.toFixed(1)}ms, P95=${stats.p95.toFixed(1)}ms, max=${stats.max.toFixed(1)}ms`);
    // PRD NFR-04 contract: P50, P90, P95 must be strictly under 2,000ms.
    // Internal safety threshold: enforce P95 < 500ms on relational index scans to guarantee sub-second headroom.
    expect(stats.p50).toBeLessThan(2000);
    expect(stats.p90).toBeLessThan(2000);
    expect(stats.p95).toBeLessThan(500);
  });

  it('measures Matter Search latency distribution (P95 < 500ms)', async () => {
    // Warmup
    await searchMatters({ query: 'نزاع استثماري', limit: 10 }, actor);

    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      const res = await searchMatters({ query: 'نزاع استثماري', limit: 10 }, actor);
      const t1 = performance.now();
      expect(res.matters.length).toBeGreaterThan(0);
      samples.push(t1 - t0);
    }

    const stats = calculatePercentiles(samples);
    console.log(`[PERF BENCHMARK] Matter Search: min=${stats.min.toFixed(1)}ms, avg=${stats.avg.toFixed(1)}ms, P50=${stats.p50.toFixed(1)}ms, P90=${stats.p90.toFixed(1)}ms, P95=${stats.p95.toFixed(1)}ms, max=${stats.max.toFixed(1)}ms`);
    // PRD NFR-04 contract: P50, P90, P95 must be strictly under 2,000ms.
    // Internal safety threshold: enforce P95 < 500ms on 2,000 matters to guarantee sub-second headroom.
    expect(stats.p50).toBeLessThan(2000);
    expect(stats.p90).toBeLessThan(2000);
    expect(stats.p95).toBeLessThan(500);
  });

  it('measures Proceeding Search latency distribution (P95 < 500ms)', async () => {
    // Warmup with Arabic digits
    await searchProceedings({ query: '١٠', limit: 10 }, actor);

    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      const res = await searchProceedings({ query: '١٠', limit: 10 }, actor);
      const t1 = performance.now();
      expect(res.proceedings.length).toBeGreaterThan(0);
      samples.push(t1 - t0);
    }

    const stats = calculatePercentiles(samples);
    console.log(`[PERF BENCHMARK] Proceeding Search: min=${stats.min.toFixed(1)}ms, avg=${stats.avg.toFixed(1)}ms, P50=${stats.p50.toFixed(1)}ms, P90=${stats.p90.toFixed(1)}ms, P95=${stats.p95.toFixed(1)}ms, max=${stats.max.toFixed(1)}ms`);
    // PRD NFR-04 contract: P50, P90, P95 must be strictly under 2,000ms.
    // Internal safety threshold: enforce P95 < 500ms on 1,200 proceedings to guarantee sub-second headroom.
    expect(stats.p50).toBeLessThan(2000);
    expect(stats.p90).toBeLessThan(2000);
    expect(stats.p95).toBeLessThan(500);
  });

  it('measures Unified Search latency distribution (P95 < 500ms)', async () => {
    // Warmup
    await unifiedSearch({ query: 'الفهد', limit: 15 }, actor);

    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      const res = await unifiedSearch({ query: 'الفهد', limit: 15 }, actor);
      const t1 = performance.now();
      expect(res.items.length).toBeGreaterThan(0);
      samples.push(t1 - t0);
    }

    const stats = calculatePercentiles(samples);
    console.log(`[PERF BENCHMARK] Unified Search: min=${stats.min.toFixed(1)}ms, avg=${stats.avg.toFixed(1)}ms, P50=${stats.p50.toFixed(1)}ms, P90=${stats.p90.toFixed(1)}ms, P95=${stats.p95.toFixed(1)}ms, max=${stats.max.toFixed(1)}ms`);
    // PRD NFR-04 contract: P50, P90, P95 must be strictly under 2,000ms across all categories.
    // Internal safety threshold: enforce P95 < 500ms for unified category aggregation.
    expect(stats.p50).toBeLessThan(2000);
    expect(stats.p90).toBeLessThan(2000);
    expect(stats.p95).toBeLessThan(500);
  });
});
