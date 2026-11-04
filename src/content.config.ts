import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { capabilitySchema, productSchema } from './data/schema';
import { parseDataYaml } from './data/yaml';

// Collections for projects (data/projects/) and events (data/events.yaml) are added
// once that data exists; their schemas already live in ./data/schema.ts.

const products = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './data/products' }),
  schema: productSchema,
});

// The content store sorts entries by id, so record the file order (= display order).
const capabilities = defineCollection({
  loader: file('data/capabilities.yaml', {
    parser: (text) => (parseDataYaml(text) as Record<string, unknown>[]).map((c, order) => ({ ...c, order })),
  }),
  schema: capabilitySchema.extend({ order: z.number().int() }),
});

export const collections = { products, capabilities };
