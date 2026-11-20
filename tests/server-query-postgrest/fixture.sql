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
