import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { performance } from 'perf_hooks';
import { getPrismaClient } from '@/lib/auth';
import { openMatter, addProceeding, searchMatters, searchProceedings, unifiedSearch } from '@/modules/matters/matter-service';
import { searchParties, saveParty } from '@/modules/parties/service';
import { createSyntheticActor, cleanupPartyFixtures, setupTestEncryptionKeys } from '../helpers/party-test-helper';
import { cleanupMatterFixtures } from '../helpers/matter-test-helper';

describe('T07 Search Performance Benchmark against PRD NFR-01 (P95 < 500ms)', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];
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

    // Seed 20 synthetic parties, 20 matters, 20 proceedings
    for (let i = 1; i <= 20; i++) {
      const pad = String(i).padStart(2, '0');
      const party = await saveParty(actor, {
        kind: i % 2 === 0 ? 'PERSON' : 'ORGANIZATION',
        name: `طرف تجريبي للأداء ${pad} شركة الفهد`,
        primaryPhone: `010${String(i).padStart(8, '0')}`,
        idempotencyKey: `perf-p-${pad}-${crypto.randomUUID()}`,
      });
      createdPartyIds.push(party.party.id);

      const matter = await openMatter(actor, {
        title: `قضية أداء المعاملات والبحث ${pad} نزاع استثماري`,
        kind: 'LITIGATION',
        status: 'ACTIVE',
        initialClientId: party.party.id,
        idempotencyKey: `perf-m-${pad}-${crypto.randomUUID()}`,
      });
      createdMatterIds.push(matter.matter.id);

      await addProceeding(actor, {
        matterId: matter.matter.id,
        courtId: testCourtId,
        instance: 'FIRST_INSTANCE',
        registerType: 'تجاري',
        circuit: `الدائرة ${pad}`,
        numberText: `${1000 + i}`,
        yearLabel: '2024',
        status: 'ACTIVE',
        idempotencyKey: `perf-proc-${pad}-${crypto.randomUUID()}`,
      });
    }
  }, 60000);

  afterAll(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupPartyFixtures(prisma, createdPartyIds);
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
    console.log(`[PERF BENCHMARK] Party Search: min=${stats.min.toFixed(1)}ms, avg=${stats.avg.toFixed(1)}ms, P50=${stats.p50.toFixed(1)}ms, P95=${stats.p95.toFixed(1)}ms, max=${stats.max.toFixed(1)}ms`);
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
    console.log(`[PERF BENCHMARK] Matter Search: min=${stats.min.toFixed(1)}ms, avg=${stats.avg.toFixed(1)}ms, P50=${stats.p50.toFixed(1)}ms, P95=${stats.p95.toFixed(1)}ms, max=${stats.max.toFixed(1)}ms`);
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
    console.log(`[PERF BENCHMARK] Proceeding Search: min=${stats.min.toFixed(1)}ms, avg=${stats.avg.toFixed(1)}ms, P50=${stats.p50.toFixed(1)}ms, P95=${stats.p95.toFixed(1)}ms, max=${stats.max.toFixed(1)}ms`);
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
    console.log(`[PERF BENCHMARK] Unified Search: min=${stats.min.toFixed(1)}ms, avg=${stats.avg.toFixed(1)}ms, P50=${stats.p50.toFixed(1)}ms, P95=${stats.p95.toFixed(1)}ms, max=${stats.max.toFixed(1)}ms`);
    expect(stats.p95).toBeLessThan(500);
  });
});
