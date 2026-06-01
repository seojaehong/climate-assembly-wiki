import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// YAML parsers may produce native Date objects for unquoted date strings.
// This helper normalises both cases to an ISO date string (YYYY-MM-DD).
const dateString = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z.coerce.date().transform((d) => d.toISOString().slice(0, 10)),
]);

// Translation entry schema (shared across all collections)
// 2026-05-31: added 'author-verified' for the Author-time Multilingual pivot (see SCHEMA.md §1.1)
const translationEntrySchema = z.object({
  status: z.enum(['machine', 'reviewed', 'native', 'author-verified']),
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
    // Unpublish flag (2026-06-02): when true, the session is excluded from
    // getStaticPaths, listing pages, sitemap, and pagefind. Source file is
    // preserved so the page can be republished by flipping this back to false.
    draft: z.boolean().default(false).optional(),
    session_type: z.enum(['kickoff', 'lecture', 'discussion', 'recommendation', 'event', 'closing']),
    speaker: z.string().optional(),
    affiliation: z.string().optional(),
    agendas_discussed: z.array(z.number().int()).default([]),
    // Blocker 1 fix (Design §2.2): ordinal session number for /sessions/{n}/ URL resolution.
    // Used by src/pages/[lang]/sessions/[n].astro via getCollection('session').find(e => e.data.order === Number(n)).
    order: z.number().int().min(1).optional(),
    // GAP-1 fix (2026-05-31): supplementary/lecture sessions that don't take an `order` slot.
    // `lecture_for` records which formal session date this lecture supports.
    // Routing layers should ignore these entries (no order ⇒ not emitted by [n].astro getStaticPaths).
    lecture_for: dateString.optional(),
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
    // D3 extension (Design §2.2): 5 new values added for tools/methods/cases collections
    // that ride on the existing doc collection rather than adding new Astro collections.
    // Unpublish flag (2026-06-02): when true, the doc is excluded from
    // getStaticPaths, listing pages, sitemap, and pagefind. Source file is
    // preserved so the page can be republished by flipping this back to false.
    draft: z.boolean().default(false).optional(),
    doc_type: z.enum([
      'brief',          // moderator-brief, etc.
      'reference',      // moderator-sources
      'guide',          // moderator-guide
      'report',         // OECD evaluation summary
      'analysis',       // gyeonggi-case, ssp-beyond
      'tool',           // en-roads comprehensive guide (wiki page)
      'method',         // ministry-matrix
      'case',           // gyeonggi-case (re-tag from analysis)
      'matrix',         // agenda-matrix
      'download-index', // downloads hub page
    ]),
    order: z.number().int(),
    license: z.literal('CC-BY-SA-4.0'),
    last_updated: dateString,
    translations: translationsSchema,
  }),
});

export const collections = { agenda, session, doc };
