-- 파싱 검증용 prelude: Supabase 전용 객체 + 마이그레이션 폴더 밖 base 테이블 stub
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgcrypto;  -- gen_random_uuid 등 public
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create schema if not exists climate_vote;

-- base 테이블 (초기 대시보드 생성분, 파일 밖) — 마이그레이션이 참조하는 컬럼 포함
create table if not exists climate_vote.session (
  id uuid primary key default gen_random_uuid(),
  slug text unique, title text, config jsonb default '{}', status text default 'draft',
  created_at timestamptz not null default now());
create table if not exists climate_vote.rounds (
  id text primary key, title text, type text, options jsonb default '[]',
  sort_order int default 0, status text default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists climate_vote.votes (
  id bigint generated always as identity primary key,
  round_id text, choice jsonb, voter_role text, client_id text,
  created_at timestamptz not null default now(), archived_at timestamptz);
create table if not exists climate_vote.snapshots (
  id bigint generated always as identity primary key,
  label text, source text, payload jsonb, created_at timestamptz not null default now());
