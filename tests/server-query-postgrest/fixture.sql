-- The PostgREST job's schema. Run after the roles `anon` and `authenticated` exist and after grid-query.sql.
create table public.items (
  id int8 primary key,
  code text,
  qty int4,
  secret text not null default 'hidden',
  tenant_id int4 not null
);

-- The hostile codes of the test, one row each, for tenant 1.
insert into public.items (id, code, qty, tenant_id) values
  (1, '"', 1, 1),
  (2, '\', 1, 1),
  (3, '%22', 1, 1),
  (4, '%5C', 1, 1),
  (5, '+', 1, 1),
  (6, 'a b', 1, 1),
  (7, ',)', 1, 1),
  (8, E'line\nbreak', 1, 1),
  (9, '"),tenant_id.neq.(1', 1, 1),
  (10, '\"),id.gt.(0', 1, 1),
  (11, '{a}', 1, 1),
  (12, 'null', 1, 1),
  (13, '', 1, 1);
insert into public.items (id, code, qty, tenant_id) select n, 'row ' || n, n % 7, 1 from pg_catalog.generate_series(100, 2099) n;
insert into public.items (id, code, qty, tenant_id) select n, 'other ' || n, n % 7, 2 from pg_catalog.generate_series(3000, 3009) n;

alter table public.items enable row level security;
create policy items_tenant on public.items for select to authenticated
  using (tenant_id = ((pg_catalog.current_setting('request.jwt.claims', true))::jsonb ->> 'tenant')::int4);
-- The column GRANT hides `secret`; the anon role gets nothing.
grant select (id, code, qty, tenant_id) on public.items to authenticated;

create function public.items_grid(plan jsonb)
returns jsonb
language sql stable security invoker
as $$ select gridcn.grid_query('public.items'::pg_catalog.regclass, array['id', 'code', 'qty', 'tenant_id']::pg_catalog.text[], plan) $$;
revoke execute on function public.items_grid(jsonb) from public, anon;
grant execute on function public.items_grid(jsonb) to authenticated;

-- The rows of tests/server-query/fixture.ts, so the client oracle is the truth of the pivot tests.
create table public.fixture_items (
  id int8 primary key, name text, tag text, score float8, qty int4, active boolean, price numeric(12,2), "createdAt" timestamptz, "tenantId" int4 not null
);
insert into public.fixture_items values
  (1, 'alpha', 'red', 0, 0, true, '0.00', '2024-01-01T00:00:00.000Z', 1),
  (2, 'Alpha', 'green', 1, 5, false, '12.50', '2024-01-01T23:59:59.999Z', 2),
  (3, 'ALPHA', 'blue', -1, 32767, null, '-3.25', '2024-01-02T00:00:00.000Z', 1),
  (4, 'beta', 'Red', 1.5, 7, true, '9999999.99', '2024-03-10T06:59:59.000Z', 2),
  (5, 'Beta', null, 2.25, 2, false, null, '2024-03-10T07:00:00.000Z', 1),
  (6, 'gamma', '', -3.75, 100, null, '1.05', '2023-12-31T23:00:00.000Z', 2),
  (7, 'delta', 'red', 10, null, true, '0.00', null, 1),
  (8, 'epsilon', 'green', 100.5, 1, false, '12.50', '2024-01-01T00:00:00.000Z', 2),
  (9, 'zeta', 'blue', null, -4, null, '-3.25', '2024-01-01T23:59:59.999Z', 1),
  (10, 'eta', 'Red', 0.1, -32768, true, '9999999.99', '2024-01-02T00:00:00.000Z', 2),
  (11, 'theta', null, 0, 0, false, null, '2024-03-10T06:59:59.000Z', 1),
  (12, 'iota', '', 1, 5, null, '1.05', '2024-03-10T07:00:00.000Z', 2),
  (13, '100% sure', 'red', -1, 32767, true, '0.00', '2023-12-31T23:00:00.000Z', 1),
  (14, 'a_b', 'green', 1.5, 7, false, '12.50', null, 2),
  (15, 'a!b', 'blue', 2.25, 2, null, '-3.25', '2024-01-01T00:00:00.000Z', 1),
  (16, 'back\slash', 'Red', -3.75, 100, true, '9999999.99', '2024-01-01T23:59:59.999Z', 2),
  (17, '[bracket]', null, 10, null, false, null, '2024-01-02T00:00:00.000Z', 1),
  (18, 'star*', '', 100.5, 1, null, '1.05', '2024-03-10T06:59:59.000Z', 2),
  (19, 'quote''d', 'red', null, -4, true, '0.00', '2024-03-10T07:00:00.000Z', 1),
  (20, 'dash--dash', 'green', 0.1, -32768, false, '12.50', '2023-12-31T23:00:00.000Z', 2),
  (21, 'semi;colon', 'blue', 0, 0, null, '-3.25', null, 1),
  (22, 'percent%', 'Red', 1, 5, true, '9999999.99', '2024-01-01T00:00:00.000Z', 2),
  (23, 'under_score', null, -1, 32767, false, null, '2024-01-01T23:59:59.999Z', 1),
  (24, 'x', '', 1.5, 7, null, '1.05', '2024-01-02T00:00:00.000Z', 2),
  (25, '', 'red', 2.25, 2, true, '0.00', '2024-03-10T06:59:59.000Z', 1),
  (26, null, 'green', -3.75, 100, false, '12.50', '2024-03-10T07:00:00.000Z', 2),
  (27, '  ', 'blue', 10, null, null, '-3.25', '2023-12-31T23:00:00.000Z', 1),
  (28, 'alpha beta', 'Red', 100.5, 1, true, '9999999.99', null, 2),
  (29, 'Gamma ray', null, null, -4, false, null, '2024-01-01T00:00:00.000Z', 1),
  (30, 'Émile', '', 0.1, -32768, null, '1.05', '2024-01-01T23:59:59.999Z', 2),
  (31, 'kappa', 'red', 0, 0, true, '0.00', '2024-01-02T00:00:00.000Z', 1),
  (32, 'lambda', 'green', 1, 5, false, '12.50', '2024-03-10T06:59:59.000Z', 2),
  (33, 'mu', 'blue', -1, 32767, null, '-3.25', '2024-03-10T07:00:00.000Z', 1),
  (34, 'nu', 'Red', 1.5, 7, true, '9999999.99', '2023-12-31T23:00:00.000Z', 2),
  (35, 'xi', null, 2.25, 2, false, null, null, 1),
  (36, 'omicron', '', -3.75, 100, null, '1.05', '2024-01-01T00:00:00.000Z', 2),
  (37, 'pi', 'red', 10, null, true, '0.00', '2024-01-01T23:59:59.999Z', 1),
  (38, 'rho', 'green', 100.5, 1, false, '12.50', '2024-01-02T00:00:00.000Z', 2),
  (39, 'sigma', 'blue', null, -4, null, '-3.25', '2024-03-10T06:59:59.000Z', 1),
  (40, 'tau', 'Red', 0.1, -32768, true, '9999999.99', '2024-03-10T07:00:00.000Z', 2),
  (41, 'upsilon', null, 0, 0, false, null, '2023-12-31T23:00:00.000Z', 1);
-- `tag` as an array and as a composite group level; NULL and '' stay NULL.
create type public.fixture_tag as (tag text);
create view public.fixture_view with (security_invoker = true) as
  select f.*, case when f.tag <> '' then array[f.tag] end as tags, case when f.tag <> '' then row(f.tag)::public.fixture_tag end as pair from public.fixture_items f;
grant select on public.fixture_items, public.fixture_view to authenticated;
create function public.fixture_grid(plan jsonb)
returns jsonb
language sql stable security invoker
as $$ select gridcn.grid_query('public.fixture_view'::pg_catalog.regclass, array['id', 'name', 'tag', 'score', 'qty', 'active', 'price', 'createdAt', 'tenantId', 'tags', 'pair']::pg_catalog.text[], plan) $$;
revoke execute on function public.fixture_grid(jsonb) from public, anon;
grant execute on function public.fixture_grid(jsonb) to authenticated;

-- Instants past the millisecond in both PostgreSQL types, millisecond-only controls, and whole epoch seconds.
create table public.stamps (id int4 primary key, at timestamp, atz timestamptz, at_ms timestamp, atz_ms timestamptz, secs int8);
insert into public.stamps values
  (1, '2024-01-01 10:00:00.123456', '2024-01-01 10:00:00.123456+00', '2024-01-01 10:00:00.123', '2024-01-01 10:00:00.123+00', 1704103200),
  (2, '2024-01-01 10:00:00.123', '2024-01-01 10:00:00.123+00', '2024-01-01 10:00:00.124', '2024-01-01 10:00:00.124+00', 1704103201),
  (3, null, null, null, null, -1);
grant select on public.stamps to authenticated;
create function public.stamps_grid(plan jsonb)
returns jsonb
language sql stable security invoker
as $$ select gridcn.grid_query('public.stamps'::pg_catalog.regclass, array['id', 'at', 'atz', 'at_ms', 'atz_ms', 'secs']::pg_catalog.text[], plan) $$;
revoke execute on function public.stamps_grid(jsonb) from public, anon;
grant execute on function public.stamps_grid(jsonb) to authenticated;
