import { describe, expect, it } from 'vitest';
import {
  renderTemplate,
  type TemplateRenderContext,
} from '../src/templates/renderTemplate';

const baseContext: TemplateRenderContext = {
  lead: {
    first_name: 'Noah',
    full_name: 'Noah Peters',
  },
  conversation: {
    id: 'c_1',
    platform: 'facebook',
    channel: 'facebook',
    state: 'DEFERRED',
    timeline: [
      { state: 'NEW', at: '2026-01-01T00:00:00.000Z' },
      { state: 'PRICE_GIVEN', at: '2026-01-02T00:00:00.000Z' },
      { state: 'DEFERRED', at: '2026-01-03T00:00:00.000Z' },
    ],
  },
  asset: {
    id: 'asset_1',
    name: 'Frontrees Studio',
  },
  business: {
    display_name: 'Frontrees',
  },
  user: {
    display_name: 'Noah',
  },
};

describe('renderTemplate', () => {
  it('renders plain variables', () => {
    const result = renderTemplate('Hi {{lead.first_name}}', baseContext);
    expect(result.text).toBe('Hi Noah');
    expect(result.missingVars).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('renders stateIs branches', () => {
    const result = renderTemplate(
      '{{#if stateIs:DEFERRED}}Deferred{{else}}Other{{/if}}',
      baseContext,
    );
    expect(result.text).toBe('Deferred');
    expect(result.errors).toEqual([]);
  });

  it('renders hadState branches from timeline', () => {
    const result = renderTemplate(
      '{{#if hadState:PRICE_GIVEN}}Honor price{{else}}Quote{{/if}}',
      baseContext,
    );
    expect(result.text).toBe('Honor price');
    expect(result.errors).toEqual([]);
  });

  it('reports missing variables and renders empty', () => {
    const context: TemplateRenderContext = {
      ...baseContext,
      lead: {
        first_name: '',
        full_name: '',
      },
    };
    const result = renderTemplate('Hi {{lead.first_name}}', context);
    expect(result.text).toBe('Hi ');
    expect(result.missingVars).toEqual(['lead.first_name']);
    expect(result.errors).toEqual([]);
  });

  it('blocks malformed templates with parse errors', () => {
    const result = renderTemplate('{{#if stateIs:DEFERRED}}hello', baseContext);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
