-- The grid function of the gridcn Supabase adapter: `createSupabaseGridQuery({ rpc: "items_grid" })`.
-- Run this file once per database, then create one wrapper per table (see the end of the file).
--
-- Trust: the plan comes from the CALLER. PostgREST exposes the wrapper, so any signed-in user can call it with any
-- plan. The function does NOT enforce `rowScope`: row-level security is the only tenancy boundary. A direct caller can
-- read every column of the wrapper's allow-list, `serverOnly` columns included; only column GRANTs hide a column.
--
-- - NEVER make the wrapper or these functions SECURITY DEFINER: row-level security would then check the owner, not the
--   caller, and the caller writes the plan.
-- - Revoke EXECUTE on the wrapper from public and anon, and grant it to authenticated (see the end of the file).
--
-- A value never enters a statement: the statement reads it from the bound plan by JSON path. Only names from the
-- wrapper's allow-list enter it, through format('%I'); operators, reducers, and directions come from closed CASE lists.
-- Every function that validates or builds the statement pins `search_path = pg_catalog, pg_temp`, so the caller's path
-- cannot change a check or a name. `grid_query` runs the statement under the caller's path, so the policies of the
-- caller's tables resolve their names as they do for PostgREST; the statement names every table, function, operator,
-- and type with its schema.

create schema if not exists gridcn;
grant usage on schema gridcn to authenticated;

-- The table `tbl` as a schema-qualified name.
create or replace function gridcn.table_sql(tbl regclass)
returns text
language sql stable security invoker
set search_path = pg_catalog, pg_temp
as $$
  select format('%I.%I', n.nspname, c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = tbl
$$;

-- The allowed, live column `name` of `tbl`, qualified by the alias `t` that every statement gives the table, so no
-- output name of the statement shadows it; any other name raises.
create or replace function gridcn.column_sql(tbl regclass, allowed text[], name text)
returns text
language plpgsql stable security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  -- coalesce: a NULL allow-list or name refuses, never passes.
  if not coalesce(name = any (allowed), false) then
    raise exception 'gridcn: the column is not in the allow-list' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_attribute a where a.attrelid = tbl and a.attname = name and a.attnum > 0 and not a.attisdropped) then
    raise exception 'gridcn: the table has no such column' using errcode = '42703';
  end if;
  return format('t.%I', name);
end $$;

-- The schema-qualified type of a column without its modifier, so a cast never rounds a numeric or cuts a varchar.
create or replace function gridcn.column_type(tbl regclass, name text)
returns text
language sql stable security invoker
set search_path = pg_catalog, pg_temp
as $$
  select format('%I.%I', n.nspname, ty.typname)
  from pg_attribute a join pg_type ty on ty.oid = a.atttypid join pg_namespace n on n.oid = ty.typnamespace
  where a.attrelid = tbl and a.attname = name and a.attnum > 0 and not a.attisdropped
$$;

-- The SQL of one filter node, PostgREST's operators with PostgREST's semantics (`not` is plain NOT).
create or replace function gridcn.filter_sql(tbl regclass, allowed text[], node jsonb, path text[], depth int default 0)
returns text
language plpgsql stable security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  op text;
  col text;
  typ text;
  item record;
  parts text[] := '{}';
begin
  if depth > 64 then
    raise exception 'gridcn: the filter is nested too deep' using errcode = '54001';
  end if;
  if jsonb_typeof(node) = 'boolean' then
    return case when node = 'true'::jsonb then 'TRUE' else 'FALSE' end;
  end if;
  if jsonb_typeof(node) is distinct from 'object' then
    raise exception 'gridcn: a filter node is an object or a boolean' using errcode = '22023';
  end if;
  if node ? 'not' or node ? 'and' or node ? 'or' then
    if (select count(*) from jsonb_object_keys(node)) <> 1 then
      raise exception 'gridcn: a group node has one key' using errcode = '22023';
    end if;
    if node ? 'not' then
      return '(NOT ' || gridcn.filter_sql(tbl, allowed, node -> 'not', path || 'not'::text, depth + 1) || ')';
    end if;
    op := case when node ? 'and' then 'and' else 'or' end;
    if jsonb_typeof(node -> op) is distinct from 'array' or jsonb_array_length(node -> op) = 0 then
      raise exception 'gridcn: a group holds a non-empty list' using errcode = '22023';
    end if;
    for item in select e.value, e.ordinality - 1 as i from jsonb_array_elements(node -> op) with ordinality e loop
      parts := parts || gridcn.filter_sql(tbl, allowed, item.value, path || array[op, item.i::text], depth + 1);
    end loop;
    return '(' || array_to_string(parts, case op when 'and' then ' AND ' else ' OR ' end) || ')';
  end if;
  if exists (select 1 from jsonb_object_keys(node) k where k not in ('c', 'op', 'v')) then
    raise exception 'gridcn: a filter leaf holds c, op, and v only' using errcode = '22023';
  end if;
  col := gridcn.column_sql(tbl, allowed, node ->> 'c');
  typ := gridcn.column_type(tbl, node ->> 'c');
  op := node ->> 'op';
  if op = 'is' then
    if node ? 'v' then
      raise exception 'gridcn: is takes no value' using errcode = '22023';
    end if;
    return col || ' IS NULL';
  end if;
  if op = 'in' then
    if jsonb_typeof(node -> 'v') is distinct from 'array' or jsonb_array_length(node -> 'v') > 200000
      or exists (select 1 from jsonb_array_elements(node -> 'v') e where jsonb_typeof(e) <> 'string') then
      raise exception 'gridcn: in takes a list of at most 200,000 texts' using errcode = '22023';
    end if;
    return format('%s OPERATOR(pg_catalog.=) ANY (CAST(ARRAY(SELECT pg_catalog.jsonb_array_elements_text($1 OPERATOR(pg_catalog.#>) %L)) AS %s[]))', col, (path || 'v'::text)::text, typ);
  end if;
  if jsonb_typeof(node -> 'v') is distinct from 'string' then
    raise exception 'gridcn: the operator takes one text value' using errcode = '22023';
  end if;
  if op in ('like', 'ilike') then
    return format('(%s)::pg_catalog.text OPERATOR(pg_catalog.%s) ($1 OPERATOR(pg_catalog.#>>) %L)', col, case op when 'like' then '~~' else '~~*' end, (path || 'v'::text)::text);
  end if;
  op := case op when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>' when 'gte' then '>=' when 'lt' then '<' when 'lte' then '<=' end;
  if op is null then
    raise exception 'gridcn: unknown operator' using errcode = '22023';
  end if;
  return format('%s OPERATOR(pg_catalog.%s) CAST(($1 OPERATOR(pg_catalog.#>>) %L) AS %s)', col, op, (path || 'v'::text)::text, typ);
end $$;

-- Raises `message`. Volatile, so the planner never folds it out of a CASE branch that is not taken.
create or replace function gridcn.refuse(message text)
returns text
language plpgsql volatile security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception '%', message using errcode = '22023';
end $$;

-- The length of the list `plan -> key`, from `minimum` to 1,000 entries; anything else raises.
create or replace function gridcn.count_of(plan jsonb, key text, minimum int)
returns int
language plpgsql immutable security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if jsonb_typeof(plan -> key) is distinct from 'array' or jsonb_array_length(plan -> key) < minimum or jsonb_array_length(plan -> key) > 1000 then
    raise exception 'gridcn: % holds between % and 1,000 entries', key, minimum using errcode = '22023';
  end if;
  return jsonb_array_length(plan -> key);
end $$;

-- `limit` and `offset` read as bigint from the bound plan; out of range raises.
create or replace function gridcn.check_page(plan jsonb, with_offset boolean)
returns void
language plpgsql immutable security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if jsonb_typeof(plan -> 'limit') is distinct from 'number' or (plan ->> 'limit')::numeric not between 0 and 100000 or (plan ->> 'limit')::numeric % 1 <> 0 then
    raise exception 'gridcn: limit is a whole number from 0 to 100,000' using errcode = '22023';
  end if;
  if with_offset and (jsonb_typeof(plan -> 'offset') is distinct from 'number' or (plan ->> 'offset')::numeric not between 0 and 9007199254740991 or (plan ->> 'offset')::numeric % 1 <> 0) then
    raise exception 'gridcn: offset is a whole number from 0' using errcode = '22023';
  end if;
end $$;

-- `col` as text, with '' read as NULL.
create or replace function gridcn.nonblank_sql(col text)
returns text
language sql immutable security invoker
set search_path = pg_catalog, pg_temp
as $$
  select format('CASE WHEN (%1$s)::pg_catalog.text OPERATOR(pg_catalog.=) '''' THEN NULL ELSE (%1$s)::pg_catalog.text END', col)
$$;

-- The aggregate of one `{ c, reducer, blank }` entry, as text; `blank` reads '' as NULL.
create or replace function gridcn.aggregate_sql(tbl regclass, allowed text[], entry jsonb)
returns text
language plpgsql stable security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  col text := gridcn.column_sql(tbl, allowed, entry ->> 'c');
  nonblank text := case when (entry -> 'blank') = 'true'::jsonb then gridcn.nonblank_sql(col) else col end;
begin
  return case entry ->> 'reducer'
    when 'sum' then format('(pg_catalog.sum(%s))::pg_catalog.text', col)
    when 'avg' then format('(pg_catalog.avg(%s))::pg_catalog.text', col)
    when 'min' then format('(pg_catalog.min(%s))::pg_catalog.text', nonblank)
    when 'max' then format('(pg_catalog.max(%s))::pg_catalog.text', nonblank)
    when 'count' then format('(pg_catalog.count(%s))::pg_catalog.text', nonblank)
    else gridcn.refuse('gridcn: unknown reducer')
  end;
end $$;

-- A group key `{ c, blank }`: the column, with '' read as NULL when `blank`.
create or replace function gridcn.key_sql(tbl regclass, allowed text[], key jsonb)
returns text
language plpgsql stable security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  col text := gridcn.column_sql(tbl, allowed, key ->> 'c');
begin
  return case when (key -> 'blank') = 'true'::jsonb then gridcn.nonblank_sql(col) else col end;
end $$;

-- The statement of one plan. It holds names and SQL only; `grid_query` runs it with the plan bound as $1.
create or replace function gridcn.grid_sql(tbl regclass, allowed text[], plan jsonb)
returns text
language plpgsql stable security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  rel text := gridcn.table_sql(tbl);
  w text;
  col text;
  key text;
  value_sql text;
  match_sql text;
  list text;
  order_sql text;
begin
  if jsonb_typeof(plan) is distinct from 'object' or not (plan ? 'where') then
    raise exception 'gridcn: the plan is an object with a where' using errcode = '22023';
  end if;
  w := gridcn.filter_sql(tbl, allowed, plan -> 'where', '{where}');
  case plan ->> 'kind'
  when 'rows' then
    perform gridcn.count_of(plan, 'select', 1), gridcn.count_of(plan, 'order', 1), gridcn.check_page(plan, true);
    select string_agg(case when (s.value -> 'text') = 'true'::jsonb then format('(%s)::pg_catalog.text AS %I', gridcn.column_sql(tbl, allowed, s.value ->> 'c'), s.value ->> 'c') else format('%s AS %I', gridcn.column_sql(tbl, allowed, s.value ->> 'c'), s.value ->> 'c') end, ', ' order by s.ordinality)
      into list from jsonb_array_elements(plan -> 'select') with ordinality s;
    select string_agg(gridcn.column_sql(tbl, allowed, o.value ->> 'c') || case when (o.value -> 'desc') = 'true'::jsonb then ' DESC NULLS LAST' else ' ASC NULLS LAST' end, ', ' order by o.ordinality)
      into order_sql from jsonb_array_elements(plan -> 'order') with ordinality o;
    return format('SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r)), ''[]''::pg_catalog.jsonb) FROM (SELECT %s FROM %s AS t WHERE %s ORDER BY %s LIMIT ($1 OPERATOR(pg_catalog.->>) ''limit'')::pg_catalog.int8 OFFSET ($1 OPERATOR(pg_catalog.->>) ''offset'')::pg_catalog.int8) r', list, rel, w, order_sql);
  when 'count' then
    return format('SELECT pg_catalog.to_jsonb(pg_catalog.count(*)) FROM %s AS t WHERE %s', rel, w);
  when 'values' then
    perform gridcn.check_page(plan, false);
    col := gridcn.column_sql(tbl, allowed, plan ->> 'c');
    case plan ->> 'form'
    when 'plain' then key := col; value_sql := col; match_sql := format('(%s)::pg_catalog.text', col);
    when 'text' then key := format('COALESCE((%s)::pg_catalog.text, '''')', col); value_sql := key; match_sql := format('(%s)::pg_catalog.text', col);
    when 'folded' then key := format('pg_catalog.lower(COALESCE((%s)::pg_catalog.text, ''''))', col); value_sql := format('pg_catalog.min(COALESCE((%s)::pg_catalog.text, ''''))', col); match_sql := format('(%s)::pg_catalog.text', col);
    when 'day' then key := format('(pg_catalog.timezone($1 OPERATOR(pg_catalog.->>) ''zone'', %s))::pg_catalog.date', col); value_sql := key; match_sql := format('(%s)::pg_catalog.text', key);
    else perform gridcn.refuse('gridcn: unknown values form');
    end case;
    if jsonb_typeof(plan -> 'pattern') = 'string' then
      w := format('(%s AND %s OPERATOR(pg_catalog.~~*) ($1 OPERATOR(pg_catalog.->>) ''pattern''))', w, match_sql);
    end if;
    return format('SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(''value'', s.v, ''count'', s.n)), ''[]''::pg_catalog.jsonb) FROM (SELECT (%s)::pg_catalog.text AS v, pg_catalog.count(*) AS n FROM %s AS t WHERE %s GROUP BY %s ORDER BY 2 DESC, 1 LIMIT ($1 OPERATOR(pg_catalog.->>) ''limit'')::pg_catalog.int8) s', value_sql, rel, w, key);
  when 'aggregates' then
    perform gridcn.count_of(plan, 'columns', 0);
    select string_agg(gridcn.aggregate_sql(tbl, allowed, a.value), ', ' order by a.ordinality) into list from jsonb_array_elements(plan -> 'columns') with ordinality a;
    return format('SELECT pg_catalog.jsonb_build_array(%s) FROM %s AS t WHERE %s', coalesce(list, ''), rel, w);
  when 'groups' then
    perform gridcn.count_of(plan, 'aggregates', 0), gridcn.check_page(plan, true);
    key := gridcn.key_sql(tbl, allowed, plan -> 'level');
    select string_agg(gridcn.aggregate_sql(tbl, allowed, a.value), ', ' order by a.ordinality) into list from jsonb_array_elements(plan -> 'aggregates') with ordinality a;
    if jsonb_typeof(plan -> 'next') = 'object' then
      col := gridcn.key_sql(tbl, allowed, plan -> 'next');
      value_sql := format('pg_catalog.count(DISTINCT %1$s) OPERATOR(pg_catalog.+) COALESCE(pg_catalog.max(CASE WHEN %1$s IS NULL THEN 1 ELSE 0 END), 0)', col);
    else
      value_sql := 'pg_catalog.count(*)';
    end if;
    return format(
      'SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(''key'', s.k, ''count'', s.n, ''childCount'', s.c, ''aggregates'', s.a)), ''[]''::pg_catalog.jsonb) FROM (SELECT (%1$s)::pg_catalog.text AS k, pg_catalog.count(*) AS n, %2$s AS c, pg_catalog.jsonb_build_array(%3$s) AS a FROM %4$s AS t WHERE %5$s GROUP BY %1$s ORDER BY %1$s %6$s NULLS LAST LIMIT ($1 OPERATOR(pg_catalog.->>) ''limit'')::pg_catalog.int8 OFFSET ($1 OPERATOR(pg_catalog.->>) ''offset'')::pg_catalog.int8) s',
      key, value_sql, coalesce(list, ''), rel, w, case when (plan -> 'desc') = 'true'::jsonb then 'DESC' else 'ASC' end);
  when 'groupCount' then
    key := gridcn.key_sql(tbl, allowed, plan -> 'level');
    return format('SELECT pg_catalog.to_jsonb(pg_catalog.count(DISTINCT %1$s) OPERATOR(pg_catalog.+) COALESCE(pg_catalog.max(CASE WHEN %1$s IS NULL THEN 1 ELSE 0 END), 0)) FROM %2$s AS t WHERE %3$s', key, rel, w);
  else
    perform gridcn.refuse('gridcn: unknown plan kind');
  end case;
  return null;
end $$;

-- Runs one plan of `createSupabaseGridQuery` against `tbl`, naming only the columns of `allowed`. It sets no
-- search_path, so the caller's policy helpers resolve their unqualified names; it names its own with their schema.
create or replace function gridcn.grid_query(tbl regclass, allowed text[], plan jsonb)
returns jsonb
language plpgsql stable security invoker
as $$
declare
  result pg_catalog.jsonb;
begin
  execute gridcn.grid_sql(tbl, allowed, plan) into result using plan;
  return result;
end $$;

revoke execute on all functions in schema gridcn from public;
grant execute on all functions in schema gridcn to authenticated;

-- One wrapper per table, in a schema PostgREST exposes, SECURITY INVOKER and without a search_path. The allow-list is
-- the wrapper's constant, never the request's: list the fields of the mapped columns. The wrapper checks no rowScope.
--
-- create or replace function public.items_grid(plan jsonb)
-- returns jsonb
-- language sql stable security invoker
-- as $$ select gridcn.grid_query('public.items'::pg_catalog.regclass, array['id', 'name', 'qty', 'tenant_id']::pg_catalog.text[], plan) $$;
-- revoke execute on function public.items_grid(jsonb) from public, anon;
-- grant execute on function public.items_grid(jsonb) to authenticated;
