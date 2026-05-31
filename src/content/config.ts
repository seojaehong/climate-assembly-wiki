import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// YAML parsers may produce native Date objects for unquoted date strings.
// This helper normalises both cases to an ISO date string (YYYY-MM-DD).
const dateString = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z.coerce.date().transform((d) => d.toISOString().slice(0, 10)),
]);

// Translation entry schema (shared across all collections)
const translationEntrySchema = z.object({
  status: z.enum(['machine', 'reviewed', 'native']),
  translator: z.string(),
  translated_at: dateString,
});

const translationsSchema = z.object({
  en: translationEntrySchema.optional(),
  ja: translationEntrySchema.optional(),
  zh: translationEntrySchema.optional(),
  es: translationEntrySchema.optional(),
}).optional();

// 1.1 Agenda — mirrors SCHEMA.md §1.1
const agenda = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/ko/agenda' }),
  schema: z.object({
    id: z.number().int().nonnegative(),
    slug: z.string(),
    title: z.string(),
    category: z.enum(['일반-의제', '메타-의제', '실행-의제']),
    status: z.enum(['proposed', 'discussed', 'recommended', 'final']),
    sessions: z.array(dateString).default([]),
    related_agendas: z.array(z.number().int()).default([]),
    ministries: z.array(z.string()).default([]),
    international_cases: z.array(z.string()).default([]),
    license: z.literal('CC-BY-SA-4.0'),
    last_updated: dateString,
    translations: translationsSchema,
  }),
});

// 1.2 Session — mirrors SCHEMA.md §1.2
const session = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/ko/session' }),
  schema: z.object({
    date: dateString,
    slug: z.string(),
    title: z.string(),
    session_type: z.enum(['kickoff', 'lecture', 'discussion', 'recommendation', 'event', 'closing']),
    speaker: z.string().optional(),
    affiliation: z.string().optional(),
    agendas_discussed: z.array(z.number().int()).default([]),
    license: z.literal('CC-BY-SA-4.0'),
    last_updated: dateString,
    translations: translationsSchema,
  }),
});

// 1.3 Doc — mirrors SCHEMA.md §1.3
const doc = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/ko/doc' }),
  schema: z.object({
    slug: z.string(),
    title: z.string(),
    doc_type: z.enum(['brief', 'reference', 'guide', 'report', 'analysis']),
    order: z.number().int(),
    license: z.literal('CC-BY-SA-4.0'),
    last_updated: dateString,
    translations: translationsSchema,
  }),
});

export const collections = { agenda, session, doc };
