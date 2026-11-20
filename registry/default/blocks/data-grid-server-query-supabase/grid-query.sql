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
-- An earlier run of this file left these signatures, which would make the calls below ambiguous.
drop function if exists gridcn.grid_query(regclass, text[], jsonb);
drop function if exists gridcn.grid_sql(regclass, text[], jsonb);
drop function if exists gridcn.check_page(jsonb, boolean);
drop function if exists gridcn.grid_query(regclass, text[], jsonb, int, int, int, int);
drop function if exists gridcn.grid_sql(regclass, text[], jsonb, int, int, int, int);
drop function if exists gridcn.aggregate_sql(regclass, text[], jsonb);

-- Bounds the plan before any catalog lookup: its text in bytes, the nodes of its filter and its pivot keys, and each
-- `in` list.
create or replace function gridcn.check_plan(plan jsonb, max_plan_bytes int, max_nodes int, max_list int)
returns void
language plpgsql immutable security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if octet_length(plan::text) > max_plan_bytes then
    raise exception 'gridcn: the plan is over % bytes', max_plan_bytes using errcode = '54000';
  end if;
  if (select count(*) from jsonb_path_query(jsonb_build_array(plan -> 'where', plan -> 'pivot'), 'strict $.** ? (@.type() == "object" || @.type() == "boolean")')) > max_nodes then
    raise exception 'gridcn: the filter has over % nodes', max_nodes using errcode = '54000';
  end if;
  if exists (select 1 from jsonb_path_query(jsonb_build_array(plan -> 'where', plan -> 'pivot'), 'strict $.** ? (@.op == "in")') leaf where jsonb_typeof(leaf -> 'v') = 'array' and jsonb_array_length(leaf -> 'v') > max_list) then
    raise exception 'gridcn: an in list holds over % values', max_list using errcode = '54000';
  end if;
end $$;

-- `value` as a boolean; anything else raises.
create or replace function gridcn.flag(value jsonb, name text)
returns boolean
language plpgsql immutable security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if jsonb_typeof(value) is distinct from 'boolean' then
    raise exception 'gridcn: % is a boolean', name using errcode = '22023';
  end if;
  return value = 'true'::jsonb;
end $$;

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

-- The comparison `op` (`<`, `<=`, `=`, `>=`, `>`) on two values of the column's type. A built-in type, or a domain over
-- one, takes pg_catalog's operator. Any other type takes the operator of its default btree operator class (citext's,
-- an enum's), which only a superuser can create, so an operator planted in the type's schema is never picked.
create or replace function gridcn.operator_sql(tbl regclass, name text, op text)
returns text
language plpgsql stable security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  typ oid;
  t record;
  found text;
begin
  select a.atttypid into typ from pg_attribute a where a.attrelid = tbl and a.attname = name and a.attnum > 0 and not a.attisdropped;
  loop
    select ty.typtype, ty.typbasetype, ty.typnamespace, ty.typelem, ty.typcategory into t from pg_type ty where ty.oid = typ;
    exit when t.typtype <> 'd';
    typ := t.typbasetype;
  end loop;
  if t.typnamespace = 'pg_catalog'::regnamespace then
    return format('OPERATOR(pg_catalog.%s)', op);
  end if;
  select format('OPERATOR(%I.%s)', n.nspname, o.oprname) into found
  from pg_opclass c
    join pg_am am on am.oid = c.opcmethod and am.amname = 'btree'
    join pg_amop ao on ao.amopfamily = c.opcfamily and ao.amopmethod = am.oid and ao.amoplefttype = c.opcintype and ao.amoprighttype = c.opcintype
      and ao.amopstrategy = array_position(array['<', '<=', '=', '>=', '>'], op)
    join pg_operator o on o.oid = ao.amopopr
    join pg_namespace n on n.oid = o.oprnamespace
  where c.opcdefault and c.opcintype = case
    when t.typtype = 'e' then 'anyenum'::regtype::oid
    when t.typtype = 'r' then 'anyrange'::regtype::oid
    when t.typtype = 'm' then 'anymultirange'::regtype::oid
    when t.typcategory = 'A' and t.typelem <> 0 then 'anyarray'::regtype::oid
    else typ end;
  if found is null then
    raise exception 'gridcn: the column "%" has no default btree operator class', name using errcode = '42883';
  end if;
  return found;
end $$;

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
    if jsonb_typeof(node -> 'v') is distinct from 'array' or exists (select 1 from jsonb_array_elements(node -> 'v') e where jsonb_typeof(e) <> 'string') then
      raise exception 'gridcn: in takes a list of texts' using errcode = '22023';
    end if;
    return format('%s %s ANY (CAST(ARRAY(SELECT pg_catalog.jsonb_array_elements_text($1 OPERATOR(pg_catalog.#>) %L)) AS %s[]))', col, gridcn.operator_sql(tbl, node ->> 'c', '='), (path || 'v'::text)::text, typ);
  end if;
  if jsonb_typeof(node -> 'v') is distinct from 'string' then
    raise exception 'gridcn: the operator takes one text value' using errcode = '22023';
  end if;
  if op in ('like', 'ilike') then
    return format('(%s)::pg_catalog.text OPERATOR(pg_catalog.%s) ($1 OPERATOR(pg_catalog.#>>) %L)', col, case op when 'like' then '~~' else '~~*' end, (path || 'v'::text)::text);
  end if;
  -- A btree operator class has no `<>`, so `neq` is NOT `=`, which keeps NULL as NULL alike.
  op := case op when 'eq' then '=' when 'neq' then '=' when 'gt' then '>' when 'gte' then '>=' when 'lt' then '<' when 'lte' then '<=' end;
  if op is null then
    raise exception 'gridcn: unknown operator' using errcode = '22023';
  end if;
  col := format('%s %s CAST(($1 OPERATOR(pg_catalog.#>>) %L) AS %s)', col, gridcn.operator_sql(tbl, node ->> 'c', op), (path || 'v'::text)::text, typ);
  return case when node ->> 'op' = 'neq' then '(NOT ' || col || ')' else col end;
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

-- `limit`, at most `max_limit`, and `offset` read as bigint from the bound plan; out of range raises.
create or replace function gridcn.check_page(plan jsonb, with_offset boolean, max_limit int)
returns void
language plpgsql immutable security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if jsonb_typeof(plan -> 'limit') is distinct from 'number' or (plan ->> 'limit')::numeric not between 0 and max_limit or (plan ->> 'limit')::numeric % 1 <> 0 then
    raise exception 'gridcn: limit is a whole number from 0 to %', max_limit using errcode = '22023';
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

-- The aggregate of one `{ c, reducer, blank }` entry, as text; `blank` reads '' as NULL. With `kept`, over the rows
-- that the SQL condition `kept` keeps.
create or replace function gridcn.aggregate_sql(tbl regclass, allowed text[], entry jsonb, kept text default null)
returns text
language plpgsql stable security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  col text := gridcn.column_sql(tbl, allowed, entry ->> 'c');
  nonblank text := case when gridcn.flag(entry -> 'blank', 'blank') then gridcn.nonblank_sql(col) else col end;
  rows_sql text := case when kept is null then '' else ' FILTER (WHERE ' || kept || ')' end;
begin
  return case entry ->> 'reducer'
    when 'sum' then format('(pg_catalog.sum(%s)%s)::pg_catalog.text', col, rows_sql)
    when 'avg' then format('(pg_catalog.avg(%s)%s)::pg_catalog.text', col, rows_sql)
    when 'min' then format('(pg_catalog.min(%s)%s)::pg_catalog.text', nonblank, rows_sql)
    when 'max' then format('(pg_catalog.max(%s)%s)::pg_catalog.text', nonblank, rows_sql)
    when 'count' then format('(pg_catalog.count(%s)%s)::pg_catalog.text', nonblank, rows_sql)
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
  return case when gridcn.flag(key -> 'blank', 'blank') then gridcn.nonblank_sql(col) else col end;
end $$;

-- The statement of one plan. It holds names and SQL only; `grid_query` runs it with the plan bound as $1.
create or replace function gridcn.grid_sql(tbl regclass, allowed text[], plan jsonb, max_plan_bytes int default 16777216, max_nodes int default 50000, max_list int default 200000, max_limit int default 1001, max_pivot_columns int default 200)
returns text
language plpgsql stable security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  rel text;
  w text;
  col text;
  key text;
  value_sql text;
  match_sql text;
  list text;
  order_sql text;
  dir text;
  eq text;
  kept text;
  cells text[] := '{}';
  item record;
  entry record;
begin
  perform gridcn.check_plan(plan, max_plan_bytes, max_nodes, max_list);
  rel := gridcn.table_sql(tbl);
  if jsonb_typeof(plan) is distinct from 'object' or not (plan ? 'where') then
    raise exception 'gridcn: the plan is an object with a where' using errcode = '22023';
  end if;
  w := gridcn.filter_sql(tbl, allowed, plan -> 'where', '{where}');
  case plan ->> 'kind'
  when 'rows' then
    perform gridcn.count_of(plan, 'select', 1), gridcn.count_of(plan, 'order', 1), gridcn.check_page(plan, true, max_limit);
    select string_agg(case when gridcn.flag(s.value -> 'text', 'text') then format('(%s)::pg_catalog.text AS %I', gridcn.column_sql(tbl, allowed, s.value ->> 'c'), s.value ->> 'c') else format('%s AS %I', gridcn.column_sql(tbl, allowed, s.value ->> 'c'), s.value ->> 'c') end, ', ' order by s.ordinality)
      into list from jsonb_array_elements(plan -> 'select') with ordinality s;
    select string_agg(gridcn.column_sql(tbl, allowed, o.value ->> 'c') || case when gridcn.flag(o.value -> 'desc', 'desc') then ' DESC NULLS LAST' else ' ASC NULLS LAST' end, ', ' order by o.ordinality)
      into order_sql from jsonb_array_elements(plan -> 'order') with ordinality o;
    return format('SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r)), ''[]''::pg_catalog.jsonb) FROM (SELECT %s FROM %s AS t WHERE %s ORDER BY %s LIMIT ($1 OPERATOR(pg_catalog.->>) ''limit'')::pg_catalog.int8 OFFSET ($1 OPERATOR(pg_catalog.->>) ''offset'')::pg_catalog.int8) r', list, rel, w, order_sql);
  when 'count' then
    return format('SELECT pg_catalog.to_jsonb(pg_catalog.count(*)) FROM %s AS t WHERE %s', rel, w);
  when 'values' then
    perform gridcn.check_page(plan, false, max_limit);
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
    perform gridcn.count_of(plan, 'aggregates', 0), gridcn.check_page(plan, true, max_limit);
    key := gridcn.key_sql(tbl, allowed, plan -> 'level');
    select string_agg(gridcn.aggregate_sql(tbl, allowed, a.value), ', ' order by a.ordinality) into list from jsonb_array_elements(plan -> 'aggregates') with ordinality a;
    if jsonb_typeof(plan -> 'next') = 'object' then
      col := gridcn.key_sql(tbl, allowed, plan -> 'next');
      value_sql := format('pg_catalog.count(DISTINCT %1$s) OPERATOR(pg_catalog.+) COALESCE(pg_catalog.max(CASE WHEN %1$s IS NULL THEN 1 ELSE 0 END), 0)', col);
    else
      value_sql := 'pg_catalog.count(*)';
    end if;
    dir := case when gridcn.flag(plan -> 'desc', 'desc') then 'DESC' else 'ASC' end;
    if jsonb_typeof(plan -> 'pivot') = 'object' then
      if gridcn.count_of(plan -> 'pivot', 'keys', 0) * gridcn.count_of(plan, 'aggregates', 0) > max_pivot_columns then
        raise exception 'gridcn: the pivot has over % cells per group', max_pivot_columns using errcode = '54000';
      end if;
      -- Each key is a filter tree, so its value stays in the bound plan and compares with the column type's operator.
      for item in select e.value, e.ordinality - 1 as i from jsonb_array_elements(plan -> 'pivot' -> 'keys') with ordinality e loop
        kept := gridcn.filter_sql(tbl, allowed, item.value, array['pivot', 'keys', item.i::text]);
        for entry in select a.value from jsonb_array_elements(plan -> 'aggregates') with ordinality a order by a.ordinality loop
          cells := cells || gridcn.aggregate_sql(tbl, allowed, entry.value, kept);
        end loop;
      end loop;
      eq := case when gridcn.flag(plan -> 'level' -> 'blank', 'blank') then 'OPERATOR(pg_catalog.=)' else gridcn.operator_sql(tbl, plan -> 'level' ->> 'c', '=') end;
      -- The page CTE picks the page's group keys, so the cells reduce only the rows of those groups.
      return format(
        'WITH gridcn_page AS (SELECT %1$s AS k FROM %4$s AS t WHERE %5$s GROUP BY %1$s ORDER BY %1$s %6$s NULLS LAST LIMIT ($1 OPERATOR(pg_catalog.->>) ''limit'')::pg_catalog.int8 OFFSET ($1 OPERATOR(pg_catalog.->>) ''offset'')::pg_catalog.int8) SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(''key'', s.k, ''count'', s.n, ''childCount'', s.c, ''aggregates'', s.a, ''cells'', s.p)), ''[]''::pg_catalog.jsonb) FROM (SELECT (%1$s)::pg_catalog.text AS k, pg_catalog.count(*) AS n, %2$s AS c, pg_catalog.jsonb_build_array(%3$s) AS a, pg_catalog.to_jsonb(ARRAY[%7$s]::pg_catalog.text[]) AS p FROM %4$s AS t WHERE (%5$s) AND ((%1$s) %8$s ANY (SELECT gp.k FROM gridcn_page AS gp) OR ((%1$s) IS NULL AND EXISTS (SELECT 1 FROM gridcn_page AS gp WHERE gp.k IS NULL))) GROUP BY %1$s ORDER BY %1$s %6$s NULLS LAST) s',
        key, value_sql, coalesce(list, ''), rel, w, dir, array_to_string(cells, ', '), eq);
    end if;
    return format(
      'SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(''key'', s.k, ''count'', s.n, ''childCount'', s.c, ''aggregates'', s.a)), ''[]''::pg_catalog.jsonb) FROM (SELECT (%1$s)::pg_catalog.text AS k, pg_catalog.count(*) AS n, %2$s AS c, pg_catalog.jsonb_build_array(%3$s) AS a FROM %4$s AS t WHERE %5$s GROUP BY %1$s ORDER BY %1$s %6$s NULLS LAST LIMIT ($1 OPERATOR(pg_catalog.->>) ''limit'')::pg_catalog.int8 OFFSET ($1 OPERATOR(pg_catalog.->>) ''offset'')::pg_catalog.int8) s',
      key, value_sql, coalesce(list, ''), rel, w, dir);
  when 'pivotKeys' then
    perform gridcn.check_page(plan, false, max_pivot_columns);
    key := gridcn.key_sql(tbl, allowed, plan -> 'level');
    return format('SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(''key'', s.k, ''total'', s.n)), ''[]''::pg_catalog.jsonb) FROM (SELECT (%1$s)::pg_catalog.text AS k, pg_catalog.count(*) OVER () AS n FROM %2$s AS t WHERE %3$s GROUP BY %1$s ORDER BY %1$s %4$s NULLS LAST LIMIT ($1 OPERATOR(pg_catalog.->>) ''limit'')::pg_catalog.int8) s',
      key, rel, w, case when gridcn.flag(plan -> 'desc', 'desc') then 'DESC' else 'ASC' end);
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
-- The defaults of the caps accept every plan the adapter sends under the core's default limits; a page is 1,000 rows
-- plus the look-ahead row, and a pivot answers at most 200 cells per group.
create or replace function gridcn.grid_query(tbl regclass, allowed text[], plan jsonb, max_plan_bytes int default 16777216, max_nodes int default 50000, max_list int default 200000, max_limit int default 1001, max_pivot_columns int default 200)
returns jsonb
language plpgsql stable security invoker
as $$
declare
  result pg_catalog.jsonb;
begin
  execute gridcn.grid_sql(tbl, allowed, plan, max_plan_bytes, max_nodes, max_list, max_limit, max_pivot_columns) into result using plan;
  return result;
end $$;

revoke execute on all functions in schema gridcn from public;
grant execute on all functions in schema gridcn to authenticated;

-- One wrapper per table, in a schema PostgREST exposes, SECURITY INVOKER and without a search_path. The allow-list is
-- the wrapper's constant, never the request's: list the fields of the mapped columns. The wrapper checks no rowScope.
-- The caps are the wrapper's constants too: pass `max_plan_bytes`, `max_nodes`, `max_list`, `max_limit`, or `max_pivot_columns` by name to
-- tighten one, and never take them from the plan.
--
-- create or replace function public.items_grid(plan jsonb)
-- returns jsonb
-- language sql stable security invoker
-- as $$ select gridcn.grid_query('public.items'::pg_catalog.regclass, array['id', 'name', 'qty', 'tenant_id']::pg_catalog.text[], plan) $$;
-- revoke execute on function public.items_grid(jsonb) from public, anon;
-- grant execute on function public.items_grid(jsonb) to authenticated;
