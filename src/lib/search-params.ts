export const MAX_SEARCH_PAGE = 1000;
export const DEFAULT_SEARCH_LIMIT = 20;

type ReadParam = (name: string) => string | undefined;

export function readParam(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = params instanceof URLSearchParams
    ? params.getAll(name)
    : params[name];
  if (typeof value === 'string') return value;
  return value?.length === 1 ? value[0] : undefined;
}

function boundedNumber(value: string | undefined, fallback: number, max: number): number {
  return value && /^\d+$/.test(value)
    ? Math.min(max, Math.max(1, Number(value)))
    : fallback;
}

export function unifiedSearchFilters(read: ReadParam) {
  const type = read('type');
  return {
    type: (['ALL', 'PARTY', 'MATTER', 'PROCEEDING'] as const).find((value) => type === value) ?? 'ALL',
    includeArchived: read('includeArchived') === 'true',
    page: boundedNumber(read('page'), 1, MAX_SEARCH_PAGE),
    limit: boundedNumber(read('limit'), DEFAULT_SEARCH_LIMIT, 50),
  };
}

export function matterSearchFilters(read: ReadParam) {
  const kind = read('kind');
  const rawStatus = read('status');
  const statusValue = rawStatus === 'SUSPENDED' ? 'ON_HOLD' : rawStatus;
  const status = (['ACTIVE', 'DRAFT', 'ON_HOLD', 'CLOSED', 'ARCHIVED'] as const)
    .find((value) => value === statusValue);
  const court = read('courtId');
  const isCourtId = court && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(court);
  return {
    kind: (['LITIGATION', 'CONSULTATION', 'CONTRACT', 'OTHER'] as const).find((value) => kind === value),
    status,
    courtId: isCourtId ? court : undefined,
    incompleteData: read('incompleteData') === 'true',
    includeArchived: read('includeArchived') === 'true',
    page: boundedNumber(read('page'), 1, MAX_SEARCH_PAGE),
    limit: boundedNumber(read('limit'), DEFAULT_SEARCH_LIMIT, 100),
  };
}
