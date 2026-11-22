import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writeHearingFromRequest } from '@/modules/scheduling/hearing-http';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';

const { requireActor } = vi.hoisted(() => ({ requireActor: vi.fn() }));
vi.mock('@/modules/identity/require-actor', () => ({ requireActor }));
vi.mock('@/lib/auth', () => ({ getTrustedOrigins: () => new Set(['https://lawoffice.test']) }));

const id = 'hearing-fixture';
const actor = { id: 'owner-fixture' };
const command = vi.fn();
function request(body: unknown, origin = 'https://lawoffice.test') {
  return new Request('https://lawoffice.test/api/scheduling/hearings/hearing-fixture/result', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('hearing write HTTP boundary', () => {
  beforeEach(() => {
    requireActor.mockReset().mockResolvedValue(actor);
    command.mockReset().mockResolvedValue({ id });
  });

  it('checks authorized write access and responds with a private, uncached result', async () => {
    const response = await writeHearingFromRequest(request({ decision: 'قرار تجريبي' }), id, command);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(requireActor).toHaveBeenCalledWith(expect.objectContaining({ requiredPermission: 'WRITE_CLIENT_DATA' }));
    expect(command).toHaveBeenCalledWith(actor, { hearingId: id, decision: 'قرار تجريبي' });
  });

  it('rejects untrusted origins and inconsistent body identifiers before calling the command', async () => {
    expect((await writeHearingFromRequest(request({}, 'https://other.test'), id, command)).status).toBe(403);
    expect(requireActor).not.toHaveBeenCalled();
    expect((await writeHearingFromRequest(request({ hearingId: 'different-fixture' }), id, command)).status).toBe(400);
    expect(command).not.toHaveBeenCalled();
  });

  it('returns safe errors for authentication, authorization and unexpected failures', async () => {
    requireActor.mockRejectedValueOnce(new AuthenticationError('UNAUTHENTICATED', 'يجب تسجيل الدخول.'));
    const unauthenticated = await writeHearingFromRequest(request({}), id, command);
    expect(unauthenticated.status).toBe(401);
    requireActor.mockRejectedValueOnce(new AuthorizationError());
    expect((await writeHearingFromRequest(request({}), id, command)).status).toBe(403);
    expect(command).not.toHaveBeenCalled();
    command.mockRejectedValueOnce(new Error('private schema detail'));
    const failed = await writeHearingFromRequest(request({}), id, command);
    expect(failed.status).toBe(500);
    expect(failed.headers.get('cache-control')).toBe('private, no-store');
    const body = await failed.json();
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.error).not.toContain('private schema detail');
  });
});
