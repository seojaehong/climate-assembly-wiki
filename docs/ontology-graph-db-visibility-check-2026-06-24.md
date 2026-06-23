# Ontology graph DB and visibility check — 2026-06-24

## Scope

This note records the verification pass for `/workshop-graph/` after the Action Surface change.

## Data source status

- The public graph page currently reads static JSON files from `public/workshop-graph/data/*.json`.
- The default workshop source is `public/workshop-graph/data/workshop-2026-06-13.json`.
- The file contains `elements.nodes = 613` and `elements.edges = 491`.
- The page does not currently read ontology nodes or edges from Supabase.

## Supabase read-only check

Using the public Supabase URL and anon key from local env, read-only REST checks against the `climate_vote` profile returned 404 for:

- `agenda`
- `agenda_link`
- `agenda_vote`
- `rounds`
- `votes`
- `snapshots`

Interpretation: the ontology graph cannot be treated as DB-backed from the public page yet. A DB-backed ontology source needs an explicit schema/table design, grants, and a seed/sync path.

## UI visibility fix

The page now renders:

- a default right-side overview card with node/edge counts and major issue hubs;
- clickable hub chips over the graph;
- always-visible overview labels for `Issue` nodes and high-degree hubs;
- brighter default nodes and edges;
- the existing hover preview and click-fixed detail cards.

## Next DB work

Recommended next slice:

1. Create an ontology schema or table set, for example `ontology.graph_sources`, `ontology.graph_nodes`, `ontology.graph_edges`.
2. Add read policies/grants for public graph rendering only.
3. Add a seed/import script that loads the existing static JSON into DB with dry-run and row-count verification.
4. Add a DB source adapter to `/workshop-graph/`, keeping static JSON as fallback.

Schema changes and bulk inserts should be approved immediately before execution.
