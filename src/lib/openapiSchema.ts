import { isRecord } from './util';

export type SpecObject = Record<string, unknown>;

/** Resolve only references within the imported JSON document. */
export function resolveSpecObject(doc: SpecObject, value: unknown): SpecObject | undefined {
  const seen = new Set<object>();
  while (isRecord(value) && typeof value.$ref === 'string') {
    if (seen.has(value) || !value.$ref.startsWith('#/')) return;
    seen.add(value);
    let pointer: string;
    try { pointer = decodeURIComponent(value.$ref.slice(2)); } catch { return; }
    value = doc;
    for (const segment of pointer.split('/')) {
      const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
      if (!isRecord(value) || !Object.hasOwn(value, key)) return;
      value = value[key];
    }
  }
  return isRecord(value) ? value : undefined;
}

export function schemaExample(doc: SpecObject, value: unknown): unknown {
  const ancestors = new Set<SpecObject>();
  // Acyclic graphs can also expand exponentially when sibling properties share a definition.
  let remaining = 2048;
  function visit(value: unknown): unknown {
    const schema = resolveSpecObject(doc, value);
    if (!schema || ancestors.has(schema) || ancestors.size >= 32 || remaining-- <= 0) return undefined;
    ancestors.add(schema);
    try {
      for (const key of ['example', 'default', 'const']) if (Object.hasOwn(schema, key)) return schema[key];
      for (const choices of [schema.examples, schema.enum]) if (Array.isArray(choices) && choices.length) return choices[0];
      const alternatives = schema.oneOf ?? schema.anyOf;
      if (Array.isArray(alternatives)) return visit(alternatives[0]);
      const props: [string, unknown][] = [];
      if (Array.isArray(schema.allOf)) {
        for (const part of schema.allOf) {
          const sample = visit(part);
          if (isRecord(sample)) props.push(...Object.entries(sample));
        }
      }
      if (isRecord(schema.properties)) {
        for (const [key, property] of Object.entries(schema.properties)) {
          if (resolveSpecObject(doc, property)?.readOnly) continue;
          const sample = visit(property);
          if (sample !== undefined) props.push([key, sample]);
        }
      }
      const type = Array.isArray(schema.type) ? schema.type.find(t => t !== 'null') : schema.type;
      if (type === 'object' || schema.properties || schema.allOf) return Object.fromEntries(props);
      if (type === 'array' || schema.items) {
        const item = visit(schema.items);
        return item === undefined ? [] : [item];
      }
      if (type === 'boolean') return false;
      if (type === 'integer' || type === 'number') return 0;
      if (type === 'null') return null;
      return '';
    } finally {
      ancestors.delete(schema);
    }
  }
  return visit(value);
}

export function mediaExample(doc: SpecObject, media: SpecObject): unknown {
  if (Object.hasOwn(media, 'example')) return media.example;
  if (isRecord(media.examples)) {
    for (const entry of Object.values(media.examples)) {
      const example = resolveSpecObject(doc, entry);
      if (example && Object.hasOwn(example, 'value')) return example.value;
    }
  }
  return schemaExample(doc, media.schema);
}
