import { describe, it, expect } from 'vitest';
import { sanitizeReturnTo } from '../../src/lib/sanitize-return-to';

describe('sanitizeReturnTo (C21 / R04-06)', () => {
  const VALID_UUID_1 = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  const VALID_UUID_2 = '7cb75f64-5717-4562-b3fc-2c963f66afa7';

  describe('Null, undefined, empty, and invalid types', () => {
    it('returns root "/" for null', () => {
      expect(sanitizeReturnTo(null)).toBe('/');
    });

    it('returns root "/" for undefined', () => {
      expect(sanitizeReturnTo(undefined)).toBe('/');
    });

    it('returns root "/" for empty string', () => {
      expect(sanitizeReturnTo('')).toBe('/');
    });

    it('returns root "/" for whitespace-only string', () => {
      expect(sanitizeReturnTo('   ')).toBe('/');
      expect(sanitizeReturnTo('\t\n')).toBe('/');
    });
  });

  describe('Root and reference routes', () => {
    it('allows root route "/"', () => {
      expect(sanitizeReturnTo('/')).toBe('/');
    });

    it('allows root route with query parameters', () => {
      expect(sanitizeReturnTo('/?ref=dashboard')).toBe('/?ref=dashboard');
    });

    it('allows /settings/security and subroutes/query', () => {
      expect(sanitizeReturnTo('/settings/security')).toBe('/settings/security');
      expect(sanitizeReturnTo('/settings/security?tab=audit')).toBe('/settings/security?tab=audit');
      expect(sanitizeReturnTo('/settings/security/sessions')).toBe('/settings/security/sessions');
    });

    it('allows /settings/reference and query', () => {
      expect(sanitizeReturnTo('/settings/reference')).toBe('/settings/reference');
      expect(sanitizeReturnTo('/settings/reference?category=courts')).toBe(
        '/settings/reference?category=courts'
      );
    });

    it('allows /offline and query', () => {
      expect(sanitizeReturnTo('/offline')).toBe('/offline');
      expect(sanitizeReturnTo('/offline?cached=true')).toBe('/offline?cached=true');
    });
  });

  describe('T06 Matters routes', () => {
    it('allows /matters and query parameters', () => {
      expect(sanitizeReturnTo('/matters')).toBe('/matters');
      expect(sanitizeReturnTo('/matters/')).toBe('/matters/');
      expect(sanitizeReturnTo('/matters?page=2&search=contract')).toBe('/matters?page=2&search=contract');
      expect(sanitizeReturnTo('/matters?status=ACTIVE&kind=LITIGATION')).toBe(
        '/matters?status=ACTIVE&kind=LITIGATION'
      );
    });

    it('allows /matters/new and query parameters', () => {
      expect(sanitizeReturnTo('/matters/new')).toBe('/matters/new');
      expect(sanitizeReturnTo('/matters/new/')).toBe('/matters/new/');
      expect(sanitizeReturnTo('/matters/new?clientId=' + VALID_UUID_1)).toBe(
        '/matters/new?clientId=' + VALID_UUID_1
      );
    });

    it('allows matter detail view with valid UUID', () => {
      expect(sanitizeReturnTo(`/matters/${VALID_UUID_1}`)).toBe(`/matters/${VALID_UUID_1}`);
      expect(sanitizeReturnTo(`/matters/${VALID_UUID_1}/`)).toBe(`/matters/${VALID_UUID_1}/`);
      expect(sanitizeReturnTo(`/matters/${VALID_UUID_1}?tab=parties`)).toBe(
        `/matters/${VALID_UUID_1}?tab=parties`
      );
    });

    it('allows matter edit view with valid UUID', () => {
      expect(sanitizeReturnTo(`/matters/${VALID_UUID_1}/edit`)).toBe(`/matters/${VALID_UUID_1}/edit`);
      expect(sanitizeReturnTo(`/matters/${VALID_UUID_1}/edit?step=details`)).toBe(
        `/matters/${VALID_UUID_1}/edit?step=details`
      );
    });

    it('allows matter proceedings list and new proceeding with valid UUID', () => {
      expect(sanitizeReturnTo(`/matters/${VALID_UUID_1}/proceedings`)).toBe(
        `/matters/${VALID_UUID_1}/proceedings`
      );
      expect(sanitizeReturnTo(`/matters/${VALID_UUID_1}/proceedings/new`)).toBe(
        `/matters/${VALID_UUID_1}/proceedings/new`
      );
    });

    it('allows proceeding detail and edit with valid UUIDs', () => {
      expect(sanitizeReturnTo(`/matters/${VALID_UUID_1}/proceedings/${VALID_UUID_2}`)).toBe(
        `/matters/${VALID_UUID_1}/proceedings/${VALID_UUID_2}`
      );
      expect(sanitizeReturnTo(`/matters/${VALID_UUID_1}/proceedings/${VALID_UUID_2}/edit`)).toBe(
        `/matters/${VALID_UUID_1}/proceedings/${VALID_UUID_2}/edit`
      );
    });
  });

  describe('Parties routes', () => {
    it('allows /parties and query parameters', () => {
      expect(sanitizeReturnTo('/parties')).toBe('/parties');
      expect(sanitizeReturnTo('/parties?role=CLIENT')).toBe('/parties?role=CLIENT');
      expect(sanitizeReturnTo('/parties?search=%D8%A3%D8%AD%D9%85%D8%AF')).toBe(
        '/parties?search=%D8%A3%D8%AD%D9%85%D8%AF'
      );
    });

    it('allows /parties/new', () => {
      expect(sanitizeReturnTo('/parties/new')).toBe('/parties/new');
    });

    it('allows party detail and edit views with valid UUID', () => {
      expect(sanitizeReturnTo(`/parties/${VALID_UUID_1}`)).toBe(`/parties/${VALID_UUID_1}`);
      expect(sanitizeReturnTo(`/parties/${VALID_UUID_1}/edit`)).toBe(`/parties/${VALID_UUID_1}/edit`);
    });

    it('allows /search and query parameters', () => {
      expect(sanitizeReturnTo('/search')).toBe('/search');
      expect(sanitizeReturnTo('/search?q=contract')).toBe('/search?q=contract');
    });

    it('allows hearing detail and result routes with valid UUID', () => {
      expect(sanitizeReturnTo(`/hearings/${VALID_UUID_1}`)).toBe(`/hearings/${VALID_UUID_1}`);
      expect(sanitizeReturnTo(`/hearings/${VALID_UUID_2}/result`)).toBe(`/hearings/${VALID_UUID_2}/result`);
    });
  });

  describe('Hostile return vectors & open redirect protection', () => {
    it('neutralizes protocol-relative URLs', () => {
      expect(sanitizeReturnTo('//evil.com')).toBe('/');
      expect(sanitizeReturnTo('//evil.com/phish')).toBe('/');
      expect(sanitizeReturnTo('///evil.com')).toBe('/');
      expect(sanitizeReturnTo('////evil.com')).toBe('/');
    });

    it('neutralizes backslash vectors', () => {
      expect(sanitizeReturnTo('/\\evil.com')).toBe('/');
      expect(sanitizeReturnTo('/\\/evil.com')).toBe('/');
      expect(sanitizeReturnTo('\\evil.com')).toBe('/');
      expect(sanitizeReturnTo('/matters\\evil.com')).toBe('/');
      expect(sanitizeReturnTo('/matters/\\evil.com')).toBe('/');
    });

    it('neutralizes explicit external schemes', () => {
      expect(sanitizeReturnTo('https://evil.com')).toBe('/');
      expect(sanitizeReturnTo('http://evil.com')).toBe('/');
      expect(sanitizeReturnTo('javascript:alert(document.cookie)')).toBe('/');
      expect(sanitizeReturnTo('data:text/html,<script>alert(1)</script>')).toBe('/');
      expect(sanitizeReturnTo('vbscript:msgbox(1)')).toBe('/');
    });

    it('neutralizes dot-segment bypass attempts', () => {
      expect(sanitizeReturnTo('/x/..//evil.com')).toBe('/');
      expect(sanitizeReturnTo('/..//evil.com')).toBe('/');
      expect(sanitizeReturnTo('/x/../\\evil.com')).toBe('/');
      expect(sanitizeReturnTo('/matters/../../etc/passwd')).toBe('/');
      expect(sanitizeReturnTo('/matters/..//evil.com')).toBe('/');
    });

    it('neutralizes control characters and CRLF injection', () => {
      expect(sanitizeReturnTo('/matters\0test')).toBe('/');
      expect(sanitizeReturnTo('/settings/security\r\nSet-Cookie: pwn=1')).toBe('/');
      expect(sanitizeReturnTo('/matters\n')).toBe('/');
      expect(sanitizeReturnTo('/matters\x1Ftest')).toBe('/');
    });

    it('neutralizes hostile query parameters containing schemes or double-slashes', () => {
      expect(sanitizeReturnTo('/matters?next=//evil.com')).toBe('/');
      expect(sanitizeReturnTo('/matters?return=https://evil.com')).toBe('/');
      expect(sanitizeReturnTo('/matters?dest=\\evil.com')).toBe('/');
      expect(sanitizeReturnTo('/matters?exec=javascript:void(0)')).toBe('/');
    });

    it('rejects unauthorized or non-allowlisted routes fail-closed to root', () => {
      expect(sanitizeReturnTo('/admin')).toBe('/');
      expect(sanitizeReturnTo('/login')).toBe('/');
      expect(sanitizeReturnTo('/login?error=session_expired')).toBe('/');
      expect(sanitizeReturnTo('/verify')).toBe('/');
      expect(sanitizeReturnTo('/api/auth/sign-out')).toBe('/');
      expect(sanitizeReturnTo('/api/users')).toBe('/');
      expect(sanitizeReturnTo('/dashboard')).toBe('/');
    });

    it('rejects malformed IDs fail-closed to root', () => {
      expect(sanitizeReturnTo('/matters/not-a-valid-uuid')).toBe('/');
      expect(sanitizeReturnTo('/matters/------------------------------------')).toBe('/');
      expect(sanitizeReturnTo('/matters/123')).toBe('/');
      expect(sanitizeReturnTo('/matters/123/edit')).toBe('/');
      expect(sanitizeReturnTo('/parties/invalid-id')).toBe('/');
      expect(sanitizeReturnTo(`/matters/${VALID_UUID_1}/proceedings/not-a-uuid`)).toBe('/');
      expect(sanitizeReturnTo('/hearings/not-a-uuid')).toBe('/');
      expect(sanitizeReturnTo('/hearings/123/result')).toBe('/');
      expect(sanitizeReturnTo('/settings/security/unknown')).toBe('/');
      expect(sanitizeReturnTo('/offline/unknown')).toBe('/');
    });
  });

  describe('Phase 1 productivity and document allowlisted routes', () => {
    it('allows /today, /agenda, /inbox, /tasks, /deadlines, /documents, and /documents/<uuid>', () => {
      expect(sanitizeReturnTo('/today')).toBe('/today');
      expect(sanitizeReturnTo('/agenda?view=month')).toBe('/agenda?view=month');
      expect(sanitizeReturnTo('/inbox?unread=true')).toBe('/inbox?unread=true');
      expect(sanitizeReturnTo('/tasks?status=OPEN')).toBe('/tasks?status=OPEN');
      expect(sanitizeReturnTo('/deadlines?window=upcoming')).toBe('/deadlines?window=upcoming');
      expect(sanitizeReturnTo('/documents?q=test')).toBe('/documents?q=test');
      expect(sanitizeReturnTo(`/documents/${VALID_UUID_1}?tab=meta`)).toBe(
        `/documents/${VALID_UUID_1}?tab=meta`
      );
    });

    it('rejects malformed or unauthorized document/productivity subroutes fail-closed', () => {
      expect(sanitizeReturnTo('/documents/not-a-uuid')).toBe('/');
      expect(sanitizeReturnTo(`/documents/${VALID_UUID_1}/edit`)).toBe('/');
      expect(sanitizeReturnTo('/today/extra')).toBe('/');
      expect(sanitizeReturnTo('/agenda/extra')).toBe('/');
      expect(sanitizeReturnTo('/tasks/123')).toBe('/');
    });
  });
});

