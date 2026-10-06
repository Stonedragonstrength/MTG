-- ============================================================
-- ONLINE TABLE — paste once into the Supabase SQL editor (same
-- ritual as garage_cards). One row per live game; knowing the
-- 6-char code is the capability to play. Direct table access is
-- denied (RLS on, zero policies, grants revoked); ALL access
-- flows through the SECURITY DEFINER functions. Codes live 24h.
-- ============================================================

create table if not exists online_games (
  code       text primary key,
  state      jsonb not null,
  version    bigint not null default 1,
  recent_ops uuid[] not null default '{}',
  app_schema int not null default 1,
  host_id    uuid not null default auth.uid(),
  ended      boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table online_games enable row level security;
revoke all on table online_games from anon, authenticated;

create or replace function table_create(p_state jsonb)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if pg_column_size(p_state) > 524288 then raise exception 'state too large'; end if;
  delete from online_games where created_at < now() - interval '24 hours';
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + floor(random() * 31)::int, 1);
    end loop;
    exit when not exists (select 1 from online_games g where g.code = c);
  end loop;
  insert into online_games (code, state) values (c, p_state);
  return c;
end;
$$;

create or replace function table_get(p_code text, p_known bigint default -1)
returns table (state jsonb, version bigint, ended boolean, app_schema int)
language sql stable security definer set search_path = public, pg_temp
as $$
  select case when g.version > p_known then g.state else null end,
         g.version, g.ended, g.app_schema
    from online_games g
   where g.code = upper(trim(p_code))
     and auth.uid() is not null
     and g.created_at > now() - interval '24 hours';
$$;

create or replace function table_save(
  p_code text, p_base bigint, p_state jsonb, p_op uuid, p_schema int default 1
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  cur online_games%rowtype;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if pg_column_size(p_state) > 524288 then raise exception 'state too large'; end if;
  select * into cur from online_games
   where code = upper(trim(p_code))
     and created_at > now() - interval '24 hours'
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'gone', true);
  end if;
  if cur.ended then
    return jsonb_build_object('ok', false, 'gone', false, 'ended', true,
      'version', cur.version, 'state', cur.state, 'app_schema', cur.app_schema);
  end if;
  if p_op = any(cur.recent_ops) then
    return jsonb_build_object('ok', true, 'duplicate', true,
      'version', cur.version, 'state', cur.state, 'app_schema', cur.app_schema);
  end if;
  if cur.version <> p_base then
    return jsonb_build_object('ok', false, 'gone', false, 'ended', false,
      'version', cur.version, 'state', cur.state, 'app_schema', cur.app_schema);
  end if;
  update online_games
     set state      = p_state,
         version    = cur.version + 1,
         recent_ops = (array_prepend(p_op, cur.recent_ops))[1:8],
         app_schema = greatest(app_schema, p_schema),
         updated_at = now()
   where code = cur.code;
  return jsonb_build_object('ok', true, 'version', cur.version + 1);
end;
$$;

create or replace function table_end(p_code text)
returns void
language sql security definer set search_path = public, pg_temp
as $$
  update online_games
     set ended = true, version = version + 1, updated_at = now()
   where code = upper(trim(p_code))
     and created_at > now() - interval '24 hours'
     and auth.uid() is not null;
$$;

revoke execute on function table_create(jsonb)                        from public, anon;
revoke execute on function table_get(text, bigint)                    from public, anon;
revoke execute on function table_save(text, bigint, jsonb, uuid, int) from public, anon;
revoke execute on function table_end(text)                            from public, anon;
grant  execute on function table_create(jsonb)                        to authenticated;
grant  execute on function table_get(text, bigint)                    to authenticated;
grant  execute on function table_save(text, bigint, jsonb, uuid, int) to authenticated;
grant  execute on function table_end(text)                            to authenticated;
