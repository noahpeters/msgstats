import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBusinessPages } from '../server/meta/client';
import { metaConfig } from '../server/meta/config';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchBusinessPages', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('falls back to client_pages when owned_pages is empty', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'p1', name: 'From Trees' }] }),
      );

    global.fetch = mockFetch as typeof fetch;

    const result = await fetchBusinessPages({
      businessId: 'biz1',
      accessToken: 'token',
      version: metaConfig.version,
    });

    expect(result.source).toBe('client_pages');
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.id).toBe('p1');

    const urls = mockFetch.mock.calls.map((call) => call[0] as string);
    expect(urls.some((url) => url.includes('/owned_pages'))).toBe(true);
    expect(urls.some((url) => url.includes('/client_pages'))).toBe(true);
  });
});
