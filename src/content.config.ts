import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { capabilitySchema, productSchema, projectSchema } from './data/schema';
import { parseDataYaml } from './data/yaml';

// The events collection (data/events.yaml) is added once that data exists; its schema
// already lives in ./data/schema.ts. Machine-generated data (data/generated/*.json) is
// imported directly via ./data/generated.ts rather than through collections.

const products = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './data/products' }),
  schema: productSchema,
});

const projects = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './data/projects' }),
  schema: projectSchema,
});

// The content store sorts entries by id, so record the file order (= display order).
const capabilities = defineCollection({
  loader: file('data/capabilities.yaml', {
    parser: (text) => (parseDataYaml(text) as Record<string, unknown>[]).map((c, order) => ({ ...c, order })),
  }),
  schema: capabilitySchema.extend({ order: z.number().int() }),
});

export const collections = { products, projects, capabilities };
