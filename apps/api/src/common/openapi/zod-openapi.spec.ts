import { healthResponseSchema } from '@marketplace/validation';
import { zodToOpenApi } from './zod-openapi';

describe('zodToOpenApi', () => {
  it('produces an OpenAPI object schema without a $schema key', () => {
    const schema = zodToOpenApi(healthResponseSchema) as Record<string, unknown>;
    expect(schema.$schema).toBeUndefined();
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(
      expect.arrayContaining(['status', 'version', 'uptimeSeconds', 'timestamp', 'components']),
    );
  });

  it('documents nullable fields in OpenAPI 3.0 style', () => {
    const schema = zodToOpenApi(healthResponseSchema) as {
      properties: { components: { items: { properties: { latencyMs: Record<string, unknown> } } } };
    };
    const latency = schema.properties.components.items.properties.latencyMs;
    expect(latency.nullable).toBe(true);
  });
});
