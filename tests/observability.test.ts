import { describe, expect, it } from 'vitest';
import {
  classifyStatusClass,
  extractMetaError,
} from '../workers/api/observability/metaFetch';
import { parseMetricsWindow } from '../workers/api/observability/window';

describe('observability helpers', () => {
  it('classifies HTTP status classes', () => {
    expect(classifyStatusClass(200)).toBe('2xx');
    expect(classifyStatusClass(302)).toBe('3xx');
    expect(classifyStatusClass(404)).toBe('4xx');
    expect(classifyStatusClass(503)).toBe('5xx');
    expect(classifyStatusClass(700)).toBe('other');
  });

  it('extracts Meta error details from payload', () => {
    const payload = {
      error: { code: 190, error_subcode: 463, type: 'OAuthException' },
    };
    expect(extractMetaError(payload)).toEqual({
      code: '190',
      subcode: '463',
      type: 'OAuthException',
    });
  });

  it('parses metrics window values', () => {
    expect(parseMetricsWindow('15m', '60m')).toBe('15m');
    expect(parseMetricsWindow(null, '60m')).toBe('60m');
    expect(parseMetricsWindow('bad', '15m')).toBeNull();
  });
});
