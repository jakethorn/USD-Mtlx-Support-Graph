import { parseDocument } from 'yaml';

/**
 * Parse a data file exactly like Astro's built-in YAML loader does (core schema, timestamps,
 * merge keys), so the validator and the site build always see identical values.
 */
export function parseDataYaml(text: string): unknown {
  const doc = parseDocument(text, { customTags: ['timestamp'], merge: true, schema: 'core' });
  if (doc.errors.length > 0) throw doc.errors[0];
  return doc.toJS();
}
