-- ============================================================================
-- migration-11: combos, add-ons, automatic offers (percent, flat, buy-X-get-Y) and correct discounted bills.
-- Run after migration-10. Every price, add-on, combo and discount is calculated HERE, never in the browser.
-- Offers: the single best offer is applied automatically to the table bill; the discount is locked when the first payment is recorded.
-- ============================================================================
do $$ begin if to_regclass('public.cafe_bill_settings') is null then raise exception 'Run migration-10 first in THIS project (see supabase/check_setup.sql).'; end if; end $$;

-- 1) menu extras: combos (fixed bundles) and add-on groups (extra shot, size, no sugar ...)
alter table menu_items add column if not exists is_combo boolean not null default false;
create table if not exists combo_items (cafe_id uuid not null references cafes(id) on delete cascade, combo_id uuid not null references menu_items(id) on delete cascade,
  item_id uuid not null references menu_items(id) on delete restrict, qty int not null default 1 check (qty between 1 and 10), primary key (combo_id, item_id));
create table if not exists addon_groups (id uuid primary key default gen_random_uuid(), cafe_id uuid not null references cafes(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40), min_select int not null default 0 check (min_select between 0 and 5), max_select int not null default 1 check (max_select between 1 and 8),
  sort_order int not null default 0, check (min_select <= max_select));
create table if not exists addons (id uuid primary key default gen_random_uuid(), group_id uuid not null references addon_groups(id) on delete cascade, cafe_id uuid not null references cafes(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40), price_minor int not null default 0 check (price_minor between 0 and 100000), is_available boolean not null default true, sort_order int not null default 0);
create table if not exists item_addon_groups (cafe_id uuid not null references cafes(id) on delete cascade, item_id uuid not null references menu_items(id) on delete cascade,
  group_id uuid not null references addon_groups(id) on delete cascade, primary key (item_id, group_id));
create index if not exists addons_group on addons (group_id); create index if not exists combo_cafe on combo_items (cafe_id); create index if not exists iag_cafe on item_addon_groups (cafe_id);

create or replace function chk_cafe_links() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'combo_items' then
    if not exists (select 1 from menu_items a join menu_items b on b.cafe_id = a.cafe_id where a.id = new.combo_id and a.is_combo and a.cafe_id = new.cafe_id and b.id = new.item_id and not b.is_combo) then raise exception 'invalid combo'; end if;
  elsif tg_table_name = 'item_addon_groups' then
    if not exists (select 1 from menu_items m join addon_groups g on g.cafe_id = m.cafe_id where m.id = new.item_id and g.id = new.group_id and m.cafe_id = new.cafe_id) then raise exception 'invalid link'; end if;
  elsif tg_table_name = 'addons' then
    if not exists (select 1 from addon_groups g where g.id = new.group_id and g.cafe_id = new.cafe_id) then raise exception 'invalid add-on'; end if;
  end if;
  return new;
end $$;
revoke all on function chk_cafe_links() from public, anon, authenticated;
drop trigger if exists chk_combo on combo_items; create trigger chk_combo before insert or update on combo_items for each row execute function chk_cafe_links();
drop trigger if exists chk_iag on item_addon_groups; create trigger chk_iag before insert or update on item_addon_groups for each row execute function chk_cafe_links();
drop trigger if exists chk_addon on addons; create trigger chk_addon before insert or update on addons for each row execute function chk_cafe_links();
alter table combo_items enable row level security; alter table addon_groups enable row level security; alter table addons enable row level security; alter table item_addon_groups enable row level security;
do $$ declare t text; begin
  foreach t in array array['combo_items', 'addon_groups', 'addons', 'item_addon_groups'] loop
    execute format('drop policy if exists "public read" on %I', t); execute format('create policy "public read" on %I for select using (is_published(cafe_id))', t);
    execute format('drop policy if exists "owner manage" on %I', t); execute format('create policy "owner manage" on %I for all to authenticated using (is_owner(cafe_id)) with check (is_owner(cafe_id))', t);
  end loop;
end $$;

-- 2) order lines remember base price, add-ons and combo contents (so kitchen, bill and history never change when the menu does)
alter table order_items add column if not exists base_price_minor int, add column if not exists addons jsonb not null default '[]', add column if not exists addons_minor int not null default 0, add column if not exists combo jsonb;

-- 3) offers: info-only (as before) plus percent, flat and buy-X-get-Y, with conditions
alter table offers add column if not exists kind text not null default 'info', add column if not exists percent numeric, add column if not exists flat_minor int,
  add column if not exists min_subtotal_minor int not null default 0, add column if not exists max_discount_minor int, add column if not exists buy_qty int, add column if not exists get_qty int,
  add column if not exists scope text not null default 'all', add column if not exists scope_ids uuid[] not null default '{}', add column if not exists starts_on date,
  add column if not exists days smallint[], add column if not exists from_time time, add column if not exists to_time time;
alter table offers drop constraint if exists offers_shape;
alter table offers add constraint offers_shape check (kind in ('info','percent','flat','bogo') and scope in ('all','items','category')
  and (percent is null or (percent > 0 and percent <= 100)) and (flat_minor is null or (flat_minor > 0 and flat_minor <= 10000000)) and min_subtotal_minor between 0 and 100000000
  and (max_discount_minor is null or (max_discount_minor > 0 and max_discount_minor <= 100000000)) and (buy_qty is null or buy_qty between 1 and 10) and (get_qty is null or get_qty between 1 and 10)
  and (kind <> 'percent' or percent is not null) and (kind <> 'flat' or flat_minor is not null) and (kind <> 'bogo' or (buy_qty is not null and get_qty is not null and scope <> 'all'))
  and (scope = 'all' or cardinality(scope_ids) between 1 and 40));

-- 4) bills keep the subtotal, the discount and which offer was applied
alter table bills add column if not exists subtotal_minor bigint not null default 0, add column if not exists discount_minor bigint not null default 0, add column if not exists offer_snapshot jsonb;
update bills set subtotal_minor = total_minor where subtotal_minor = 0 and total_minor > 0;

create or replace function _inr(p bigint) returns text language sql immutable as $$ select '₹' || trim(trailing '.' from to_char(p / 100.0, 'FM9999999990.99')) $$;
create or replace function _offer_live(o offers) returns boolean language plpgsql stable set search_path = public as $$
declare t timestamp := now() at time zone 'Asia/Kolkata';
begin
  return o.is_active and (o.starts_on is null or o.starts_on <= t::date) and (o.valid_until is null or o.valid_until >= t::date)
    and (o.days is null or extract(dow from t)::int = any(o.days))
    and (o.from_time is null or o.to_time is null or case when o.from_time <= o.to_time then t::time between o.from_time and o.to_time else (t::time >= o.from_time or t::time <= o.to_time) end);
end $$;
create or replace function _offer_rule(o offers) returns text language plpgsql stable set search_path = public as $$
declare v_scope text := ''; v_min text := '';
begin
  if o.scope = 'items' then v_scope := ' on ' || coalesce((select string_agg(n, ', ') from (select name as n from menu_items where id = any(o.scope_ids) and cafe_id = o.cafe_id order by name limit 3) q), 'selected items');
  elsif o.scope = 'category' then v_scope := ' on ' || coalesce((select string_agg(n, ', ') from (select name as n from menu_categories where id = any(o.scope_ids) and cafe_id = o.cafe_id order by name limit 3) q), 'selected categories'); end if;
  if o.min_subtotal_minor > 0 then v_min := ' for orders above ' || _inr(o.min_subtotal_minor); end if;
  return case o.kind
    when 'percent' then trim(trailing '.' from to_char(o.percent, 'FM990.99')) || '% off' || v_scope || v_min || case when o.max_discount_minor is not null then ' (up to ' || _inr(o.max_discount_minor) || ')' else '' end
    when 'flat' then _inr(o.flat_minor) || ' off' || v_scope || v_min
    when 'bogo' then 'Buy ' || o.buy_qty || ', get ' || o.get_qty || ' free' || v_scope || v_min
    else coalesce(o.details, '') end;
end $$;

-- 5) the offer engine: picks the single best live offer for a set of bill lines and says exactly what it discounts
create or replace function _offer_eval(p_cafe uuid, p_lines jsonb) returns jsonb language plpgsql stable set search_path = public as $$
declare o offers%rowtype; v_sub bigint; v_elig bigint; v_d bigint; v_best bigint := 0; best jsonb := null; v_units jsonb; v_free int; v_i int; v_cnt jsonb; v_free_items jsonb;
begin
  select coalesce(sum((l->>'total_minor')::bigint), 0) into v_sub from jsonb_array_elements(p_lines) l;
  if v_sub <= 0 then return null; end if;
  for o in select * from offers where cafe_id = p_cafe and kind <> 'info' and _offer_live(offers) order by created_at loop
    if v_sub < o.min_subtotal_minor then continue; end if;
    select coalesce(sum((l->>'total_minor')::bigint), 0) into v_elig from jsonb_array_elements(p_lines) l
      where o.scope = 'all' or (o.scope = 'items' and (l->>'item_id')::uuid = any(o.scope_ids)) or (o.scope = 'category' and (l->>'category_id')::uuid = any(o.scope_ids));
    if v_elig <= 0 then continue; end if;
    v_d := 0; v_free_items := null;
    if o.kind = 'percent' then v_d := floor(v_elig * o.percent / 100);
    elsif o.kind = 'flat' then v_d := least(o.flat_minor, v_elig);
    elsif o.kind = 'bogo' then
      select coalesce(jsonb_agg(jsonb_build_object('n', l->>'name', 'u', (l->>'base_minor')::bigint) order by (l->>'base_minor')::bigint), '[]'::jsonb) into v_units
        from jsonb_array_elements(p_lines) l, generate_series(1, (l->>'qty')::int) g
        where (o.scope = 'items' and (l->>'item_id')::uuid = any(o.scope_ids)) or (o.scope = 'category' and (l->>'category_id')::uuid = any(o.scope_ids));
      v_free := (jsonb_array_length(v_units) / (o.buy_qty + o.get_qty)) * o.get_qty; v_cnt := '{}'::jsonb;
      for v_i in 1..v_free loop
        v_d := v_d + (v_units->(v_i - 1)->>'u')::bigint;
        v_cnt := jsonb_set(v_cnt, array[v_units->(v_i - 1)->>'n'], to_jsonb(coalesce((v_cnt->>(v_units->(v_i - 1)->>'n'))::int, 0) + 1));
      end loop;
      select jsonb_agg(jsonb_build_object('name', k, 'qty', val::int)) into v_free_items from jsonb_each_text(v_cnt) as t(k, val);
    end if;
    if o.kind <> 'bogo' and o.max_discount_minor is not null then v_d := least(v_d, o.max_discount_minor); end if;
    v_d := least(v_d, v_sub);
    if v_d > v_best then v_best := v_d; best := jsonb_build_object('offer_id', o.id, 'title', o.title, 'kind', o.kind, 'discount_minor', v_d, 'rule', _offer_rule(o), 'free_items', v_free_items); end if;
  end loop;
  return best;
end $$;

create or replace function _bill_recalc(p_bill uuid) returns void language plpgsql security definer set search_path = public as $$
declare b bills%rowtype; v_lines jsonb; v_sub bigint; v_off jsonb; v_disc bigint;
begin
  select * into b from bills where id = p_bill for update;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', i.menu_item_id, 'category_id', m.category_id, 'name', i.name_snapshot, 'qty', i.quantity, 'base_minor', coalesce(i.base_price_minor, i.unit_price_minor), 'total_minor', i.line_total_minor)), '[]'::jsonb),
         coalesce(sum(i.line_total_minor), 0)
    into v_lines, v_sub
  from order_items i join orders o on o.id = i.order_id left join menu_items m on m.id = i.menu_item_id where o.bill_id = p_bill and o.status not in ('pending', 'cancelled');
  if b.paid_minor = 0 then   -- offers are recalculated until the first payment, then the discount is locked
    v_off := _offer_eval(b.cafe_id, v_lines); v_disc := coalesce((v_off->>'discount_minor')::bigint, 0);
    update bills set subtotal_minor = v_sub, discount_minor = v_disc, offer_snapshot = v_off, total_minor = v_sub - v_disc where id = p_bill;
  else
    update bills set subtotal_minor = v_sub, total_minor = greatest(v_sub - b.discount_minor, 0) where id = p_bill;
  end if;
end $$;

-- 6) pricing of a cart: validates every item, add-on choice and combo, and returns server prices
create or replace function _price_lines(p_cafe uuid, p_items jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record; m record; v_lines jsonb := '[]'::jsonb; v_bad jsonb := '[]'::jsonb; v_opt jsonb := '[]'::jsonb; v_addons jsonb; v_asum bigint; v_cnt int; v_combo jsonb; v_allok boolean; v_total bigint := 0; v_qty int := 0; v_unit bigint; v_tot bigint;
  v_uuid text := '^[0-9a-fA-F-]{36}$';
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then return _fail('invalid'); end if;
  if exists (select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e) <> 'object' or coalesce(e->>'id', '') !~ v_uuid or coalesce(e->>'qty', '') !~ '^[0-9]{1,2}$'
      or (e ? 'addons' and (jsonb_typeof(e->'addons') <> 'array' or jsonb_array_length(e->'addons') > 8 or exists (select 1 from jsonb_array_elements(e->'addons') a where jsonb_typeof(a) <> 'string' or (a #>> '{}') !~ v_uuid)))) then return _fail('invalid'); end if;
  for r in
    select id, adds, sum(qty)::int as qty from (
      select (e->>'id')::uuid as id, (e->>'qty')::int as qty,
             coalesce((select array_agg(distinct (a #>> '{}')::uuid order by (a #>> '{}')::uuid) from jsonb_array_elements(coalesce(e->'addons', '[]'::jsonb)) a), '{}'::uuid[]) as adds
      from jsonb_array_elements(p_items) e) q group by id, adds
  loop
    if r.qty not between 1 and 20 then return _fail('invalid'); end if;
    select mi.id, mi.name, mi.price_paise, mi.category_id, mi.is_combo, mi.is_available, coalesce(c.is_visible, false) as vis into m
      from menu_items mi left join menu_categories c on c.id = mi.category_id where mi.id = r.id and mi.cafe_id = p_cafe;
    if m.id is null or not m.is_available or not m.vis then v_bad := v_bad || to_jsonb(coalesce(m.name, 'An item')); continue; end if;
    v_combo := null;
    if m.is_combo then
      select jsonb_agg(jsonb_build_object('name', x.name, 'qty', x.cq) order by x.name), bool_and(x.is_available) into v_combo, v_allok
        from (select mi.name, mi.is_available, ci.qty as cq from combo_items ci join menu_items mi on mi.id = ci.item_id and mi.cafe_id = p_cafe where ci.combo_id = m.id) x;
      if v_combo is null or not v_allok then v_bad := v_bad || to_jsonb(m.name); continue; end if;
    end if;
    v_addons := '[]'::jsonb; v_asum := 0;
    if cardinality(r.adds) > 0 then
      select coalesce(jsonb_agg(jsonb_build_object('id', ad.id, 'name', ad.name, 'price_minor', ad.price_minor) order by ad.name), '[]'::jsonb), coalesce(sum(ad.price_minor), 0), count(*)
        into v_addons, v_asum, v_cnt
        from addons ad where ad.id = any(r.adds) and ad.cafe_id = p_cafe and ad.is_available and exists (select 1 from item_addon_groups ig where ig.item_id = m.id and ig.group_id = ad.group_id);
      if v_cnt <> cardinality(r.adds) then v_bad := v_bad || to_jsonb(m.name); continue; end if;
    end if;
    if exists (select 1 from item_addon_groups ig join addon_groups g on g.id = ig.group_id where ig.item_id = m.id and
        ((select count(*) from addons a2 where a2.group_id = g.id and a2.id = any(r.adds)) < g.min_select or (select count(*) from addons a2 where a2.group_id = g.id and a2.id = any(r.adds)) > g.max_select)) then
      v_opt := v_opt || to_jsonb(m.name); continue;
    end if;
    v_unit := m.price_paise + v_asum; v_tot := v_unit * r.qty; v_total := v_total + v_tot; v_qty := v_qty + r.qty;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('item_id', m.id, 'category_id', m.category_id, 'name', m.name, 'qty', r.qty, 'base_minor', m.price_paise, 'addons_minor', v_asum,
                'unit_minor', v_unit, 'total_minor', v_tot, 'addons', v_addons, 'combo', v_combo));
  end loop;
  if jsonb_array_length(v_bad) > 0 then return jsonb_build_object('ok', false, 'reason', 'unavailable', 'names', v_bad); end if;
  if jsonb_array_length(v_opt) > 0 then return jsonb_build_object('ok', false, 'reason', 'options', 'names', v_opt); end if;
  if v_qty > 60 or v_total > 10000000 then return _fail('invalid'); end if;
  return jsonb_build_object('ok', true, 'lines', v_lines, 'total_minor', v_total);
exception when data_exception then return _fail('invalid');
end $$;

-- 7) order creation, status changes, sales summary and the staff board, now offer-aware
create or replace function _pos_create_order(p_cafe uuid, p_table uuid, p_source text, p_idem text, p_items jsonb, p_note text, p_cap uuid, p_actor uuid, p_expected bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ex orders%rowtype; v_lines jsonb; v_total bigint; v_sess uuid; v_bill uuid; v_bstat text; v_sstat text;
  v_pr jsonb; v_order uuid; v_ref text; v_try int := 0; v_loop int := 0; v_note text;
  v_status text := case when p_source = 'customer' then 'pending' else 'received' end;   -- guests' orders wait for staff approval
begin
  if p_idem is null or p_idem !~ '^[A-Za-z0-9_-]{16,64}$' then return _fail('invalid'); end if;
  -- duplicate submit / network retry: return the order that already exists
  select * into v_ex from orders where cafe_id = p_cafe and idempotency_key = p_idem;
  if v_ex.id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'ref', v_ex.ref, 'status', v_ex.status, 'total_minor', v_ex.total_minor);
  end if;
  v_pr := _price_lines(p_cafe, p_items);   -- all prices, add-ons, combos and availability are read from OUR tables
  if not (v_pr->>'ok')::boolean then return v_pr; end if;
  v_lines := v_pr->'lines'; v_total := (v_pr->>'total_minor')::bigint;
  if p_expected is not null and p_expected <> v_total then
    return jsonb_build_object('ok', false, 'reason', 'price_changed', 'total_minor', v_total);
  end if;
  v_note := nullif(left(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), 140), '');

  -- get-or-create the ONE open session and its bill; the bill row lock serialises concurrent orders and closing
  loop
    v_loop := v_loop + 1;
    insert into table_sessions (cafe_id, table_id, opened_by) values (p_cafe, p_table, p_actor)
      on conflict (table_id) where status = 'open' do nothing;
    select id into v_sess from table_sessions where table_id = p_table and status = 'open';
    if v_sess is not null then
      insert into bills (cafe_id, session_id) values (p_cafe, v_sess) on conflict (session_id) do nothing;
      select id, status into v_bill, v_bstat from bills where session_id = v_sess for update;
      select status into v_sstat from table_sessions where id = v_sess;
      exit when v_bstat = 'open' and v_sstat = 'open';
    end if;
    if v_loop >= 3 then return _fail('busy'); end if;
  end loop;

  loop
    v_ref := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into orders (cafe_id, session_id, bill_id, ref, status, source, idempotency_key, capability_id, note, total_minor, created_by)
        values (p_cafe, v_sess, v_bill, v_ref, v_status, p_source, p_idem, p_cap, v_note, v_total, p_actor) returning id into v_order;
      exit;
    exception when unique_violation then
      select * into v_ex from orders where cafe_id = p_cafe and idempotency_key = p_idem;
      if v_ex.id is not null then
        return jsonb_build_object('ok', true, 'duplicate', true, 'ref', v_ex.ref, 'status', v_ex.status, 'total_minor', v_ex.total_minor);
      end if;
      v_try := v_try + 1;
      if v_try > 5 then return _fail('busy'); end if;
    end;
  end loop;

  insert into order_items (cafe_id, order_id, menu_item_id, name_snapshot, unit_price_minor, quantity, line_total_minor, base_price_minor, addons, addons_minor, combo)
    select p_cafe, v_order, (l->>'item_id')::uuid, l->>'name', (l->>'unit_minor')::int, (l->>'qty')::int, (l->>'total_minor')::bigint, (l->>'base_minor')::int,
           coalesce(l->'addons', '[]'::jsonb), (l->>'addons_minor')::int, case when jsonb_typeof(l->'combo') = 'array' then l->'combo' end
    from jsonb_array_elements(v_lines) l;
  if v_status = 'received' then perform _bill_recalc(v_bill); end if;   -- guest orders join the bill (and its offers) only once staff approve them
  if p_source = 'staff' then perform _audit(p_cafe, 'pos', 'order.counter_created', v_ref, jsonb_build_object('total_minor', v_total)); end if;
  return jsonb_build_object('ok', true, 'ref', v_ref, 'status', v_status, 'total_minor', v_total);
exception when data_exception then
  return _fail('invalid');
end $$;

create or replace function pos_set_order_status(p_order uuid, p_status text) returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; b bills%rowtype; v_front boolean; v_kitchen boolean; v_ok boolean;
begin
  select * into o from orders where id = p_order;
  if o.id is null then raise exception 'not allowed' using errcode = '42501'; end if;
  v_front := staff_can(o.cafe_id, 'orders'); v_kitchen := staff_can(o.cafe_id, 'kitchen');
  if not (v_front or v_kitchen) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into b from bills where id = o.bill_id for update;
  select * into o from orders where id = p_order for update;
  if b.status <> 'open' then return _fail('closed'); end if;
  v_ok := (o.status = 'pending' and p_status in ('received', 'cancelled')) or (o.status = 'received' and p_status in ('preparing', 'cancelled'))
       or (o.status = 'preparing' and p_status in ('ready', 'cancelled')) or (o.status = 'ready' and p_status in ('completed', 'cancelled'));
  if not v_ok then return _fail('transition'); end if;
  -- kitchen-only staff may only move approved orders to preparing and ready
  if not v_front and not ((o.status = 'received' and p_status = 'preparing') or (o.status = 'preparing' and p_status = 'ready')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  begin
    update orders set status = p_status, updated_at = now() where id = o.id;
    perform _bill_recalc(b.id);
    if (select paid_minor > total_minor from bills where id = b.id) then raise exception 'paid_exceeds' using errcode = 'P0001'; end if;
  exception when sqlstate 'P0001' then
    if sqlerrm = 'paid_exceeds' then return _fail('paid_exceeds'); end if;
    raise;
  end;
  perform _audit(o.cafe_id, 'pos', 'order.' || p_status, o.ref, '{}');
  if p_status = 'cancelled' and not exists (select 1 from orders where session_id = o.session_id and status <> 'cancelled') then
    update table_sessions set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = o.session_id and status = 'open';
    update bills set status = 'closed', closed_at = now() where id = b.id;
    perform _audit(o.cafe_id, 'pos', 'session.auto_closed', o.session_id::text, '{}');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function pos_sales_summary(p_cafe uuid, p_from date, p_to date) returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  perform _require(p_cafe, 'reports');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then return _fail('range'); end if;
  return jsonb_build_object('ok', true,
    'orders', (select count(*) from orders o where o.cafe_id = p_cafe and o.status not in ('pending', 'cancelled') and (o.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to),
    'billed_minor', (select coalesce(sum(o.total_minor), 0) from orders o where o.cafe_id = p_cafe and o.status not in ('pending', 'cancelled') and (o.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to),
    'discount_minor', (select coalesce(sum(bl.discount_minor), 0) from bills bl where bl.cafe_id = p_cafe and (bl.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to),
    'cash_minor', (select coalesce(sum(amount_minor), 0) from payment_events where cafe_id = p_cafe and method = 'cash' and (recorded_at at time zone 'Asia/Kolkata')::date between p_from and p_to),
    'upi_minor', (select coalesce(sum(amount_minor), 0) from payment_events where cafe_id = p_cafe and method = 'upi' and (recorded_at at time zone 'Asia/Kolkata')::date between p_from and p_to),
    'top_items', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select i.name_snapshot as name, sum(i.quantity)::int as qty from order_items i join orders o on o.id = i.order_id
        where i.cafe_id = p_cafe and o.status not in ('pending', 'cancelled') and (o.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
        group by 1 order by 2 desc limit 5) t));
end $$;

create or replace function pos_board(p_cafe uuid, p_view text default 'full') returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_front boolean := staff_can(p_cafe, 'orders'); v_kit boolean := staff_can(p_cafe, 'kitchen'); v_sess uuid[]; v_k boolean := (p_view = 'kitchen');
begin
  if not (v_front or v_kit) or (not v_k and not v_front) then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(array_agg(id), '{}') into v_sess from table_sessions where cafe_id = p_cafe and status = 'open';
  return jsonb_build_object('ok', true,
    'tables', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'is_active', is_active) order by created_at), '[]'::jsonb) from cafe_tables where cafe_id = p_cafe),
    'sessions', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'table_id', table_id, 'opened_at', opened_at)), '[]'::jsonb) from table_sessions where id = any(v_sess)),
    'bills', case when v_k then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'session_id', session_id, 'subtotal_minor', subtotal_minor, 'discount_minor', discount_minor, 'offer', offer_snapshot, 'total_minor', total_minor, 'paid_minor', paid_minor, 'bill_no', bill_no)), '[]'::jsonb) from bills where session_id = any(v_sess)) end,
    'orders', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'session_id', session_id, 'ref', ref, 'status', status, 'source', source, 'note', note, 'total_minor', total_minor, 'created_at', created_at) order by created_at), '[]'::jsonb)
               from orders where session_id = any(v_sess) and (not v_k or status in ('received', 'preparing', 'ready'))),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('order_id', i.order_id, 'name_snapshot', i.name_snapshot, 'quantity', i.quantity, 'line_total_minor', i.line_total_minor, 'addons', i.addons, 'combo', i.combo)), '[]'::jsonb)
              from order_items i join orders o on o.id = i.order_id where o.session_id = any(v_sess) and (not v_k or o.status in ('received', 'preparing', 'ready'))),
    'payments', case when v_k then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'bill_id', p.bill_id, 'amount_minor', p.amount_minor, 'method', p.method, 'event_type', p.event_type, 'corrects', p.corrects, 'recorded_at', p.recorded_at, 'note', p.note) order by p.recorded_at), '[]'::jsonb)
              from payment_events p join bills b on b.id = p.bill_id where b.session_id = any(v_sess)) end);
end $$;

-- 8) the bill, for guests and staff: lines with add-ons and combo contents, the offer that was applied, tax included
create or replace function _bill_json(p_bill uuid, p_cap uuid) returns jsonb language plpgsql security definer stable set search_path = public as $$
declare b bills%rowtype; c cafes%rowtype; s cafe_bill_settings%rowtype; v_table text; v_lines jsonb; v_view_sub bigint; v_all_sub bigint; v_shared boolean; v_rates jsonb; v_sum numeric := 0; v_tax jsonb := '[]'::jsonb; v_taxsum bigint := 0; v_t bigint; e jsonb; v_methods jsonb; v_state text; v_orders jsonb;
begin
  select * into b from bills where id = p_bill; if b.id is null then return _fail('none'); end if;
  select * into c from cafes where id = b.cafe_id; select * into s from cafe_bill_settings where cafe_id = b.cafe_id;
  select t.display_name into v_table from table_sessions ts join cafe_tables t on t.id = ts.table_id where ts.id = b.session_id;
  select coalesce(jsonb_agg(jsonb_build_object('name', q.name, 'qty', q.qty, 'unit_minor', q.unit, 'total_minor', q.tot, 'addons', q.addons, 'combo', q.combo) order by q.name), '[]'::jsonb), coalesce(sum(q.tot), 0)
    into v_lines, v_view_sub
  from (select i.name_snapshot as name, i.unit_price_minor as unit, i.addons, i.combo, sum(i.quantity)::int as qty, sum(i.line_total_minor)::bigint as tot
        from order_items i join orders o on o.id = i.order_id where o.bill_id = p_bill and o.status not in ('pending', 'cancelled') and (p_cap is null or o.capability_id = p_cap)
        group by i.name_snapshot, i.unit_price_minor, i.addons, i.combo) q;
  select coalesce(sum(i.line_total_minor), 0) into v_all_sub from order_items i join orders o on o.id = i.order_id where o.bill_id = p_bill and o.status not in ('pending', 'cancelled');
  v_shared := p_cap is not null and v_view_sub <> v_all_sub;   -- other guests also ordered on this table bill: they only see table totals, never other people's items
  v_rates := coalesce(b.tax_rates, case when s.tax_feature_enabled and s.tax_confirmed and jsonb_array_length(s.tax_lines) > 0 then s.tax_lines end);
  if v_rates is not null and not v_shared then
    select coalesce(sum((x->>'rate')::numeric), 0) into v_sum from jsonb_array_elements(v_rates) x;
    if v_sum > 0 then
      for e in select value from jsonb_array_elements(v_rates) loop
        v_t := round(b.total_minor * (e->>'rate')::numeric / (100 + v_sum));
        v_tax := v_tax || jsonb_build_array(jsonb_build_object('name', e->>'name', 'rate', (e->>'rate')::numeric, 'amount_minor', v_t)); v_taxsum := v_taxsum + v_t;
      end loop;
    end if;
  end if;
  v_state := case when b.total_minor = 0 then 'none' when b.paid_minor >= b.total_minor then 'paid' when b.paid_minor > 0 then 'partial' else 'pending' end;
  select coalesce(jsonb_agg(jsonb_build_object('method', m.method, 'amount_minor', case when p_cap is null then m.amt end) order by m.method), '[]'::jsonb) into v_methods
    from (select method, sum(amount_minor) as amt from payment_events where bill_id = p_bill group by method having sum(amount_minor) <> 0) m;
  select coalesce(jsonb_agg(jsonb_build_object('ref', o.ref, 'status', o.status) order by o.created_at), '[]'::jsonb) into v_orders from orders o where o.bill_id = p_bill and (p_cap is null or o.capability_id = p_cap);
  return jsonb_build_object('ok', true,
    'cafe', jsonb_build_object('name', coalesce(nullif(s.display_name, ''), c.name), 'address', coalesce(s.address, c.settings->>'address'), 'phone', coalesce(s.phone, c.settings->>'phone'), 'footer', s.footer, 'theme', c.theme, 'design', coalesce(c.settings->'design', '{}'::jsonb)),
    'bill_no', b.bill_no, 'label', case when b.bill_no is null then null else 'B-' || lpad(b.bill_no::text, 5, '0') end, 'date', coalesce(b.settled_at, b.created_at), 'table', v_table,
    'lines', v_lines, 'subtotal_minor', v_view_sub, 'bill_subtotal_minor', v_all_sub, 'discount_minor', b.discount_minor, 'offer', b.offer_snapshot, 'total_minor', b.total_minor,
    'tax', v_tax, 'taxable_minor', b.total_minor - v_taxsum, 'payment', jsonb_build_object('state', v_state, 'methods', v_methods), 'orders', v_orders, 'shared', v_shared, 'guest_only', p_cap is not null);
end $$;

-- 9) what a guest sees while ordering: the cart priced by the server, plus the offer that WOULD apply to the table bill (nothing is saved)
create or replace function pos_preview(p_cafe uuid, p_cap text, p_items jsonb) returns jsonb language plpgsql security definer stable set search_path = public as $$
declare cap order_capabilities%rowtype; v_pr jsonb; v_exist jsonb := '[]'::jsonb; v_all jsonb; v_off jsonb; v_bill bills%rowtype; v_sub bigint; v_disc bigint; v_next jsonb;
begin
  if not exists (select 1 from cafes where id = p_cafe and published and plan_tier = 'pos' and not suspended) then return _fail('unavailable'); end if;
  v_pr := _price_lines(p_cafe, p_items); if not (v_pr->>'ok')::boolean then return v_pr; end if;
  if p_cap is not null and char_length(p_cap) = 64 then   -- with a valid table session the table's current bill is included
    select * into cap from order_capabilities where token_hash = encode(sha256(convert_to(p_cap, 'UTF8')), 'hex') and cafe_id = p_cafe and not revoked and expires_at > now();
    if cap.id is not null then select b.* into v_bill from bills b join table_sessions s on s.id = b.session_id where s.table_id = cap.table_id and s.status = 'open'; end if;
  end if;
  if v_bill.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('item_id', i.menu_item_id, 'category_id', m.category_id, 'name', i.name_snapshot, 'qty', i.quantity, 'base_minor', coalesce(i.base_price_minor, i.unit_price_minor), 'total_minor', i.line_total_minor)), '[]'::jsonb)
      into v_exist from order_items i join orders o on o.id = i.order_id left join menu_items m on m.id = i.menu_item_id where o.bill_id = v_bill.id and o.status not in ('pending', 'cancelled');
  end if;
  v_all := v_exist || (v_pr->'lines');
  select coalesce(sum((l->>'total_minor')::bigint), 0) into v_sub from jsonb_array_elements(v_all) l;
  if v_bill.id is not null and v_bill.paid_minor > 0 then v_off := v_bill.offer_snapshot; v_disc := v_bill.discount_minor; else v_off := _offer_eval(p_cafe, v_all); v_disc := coalesce((v_off->>'discount_minor')::bigint, 0); end if;
  select jsonb_build_object('title', o.title, 'rule', _offer_rule(o), 'need_minor', o.min_subtotal_minor - v_sub) into v_next from offers o
    where o.cafe_id = p_cafe and o.kind in ('percent', 'flat') and o.scope = 'all' and o.min_subtotal_minor > v_sub and _offer_live(o) order by o.min_subtotal_minor limit 1;
  return jsonb_build_object('ok', true, 'next_offer', v_next, 'cart_total_minor', (v_pr->>'total_minor')::bigint, 'table_subtotal_minor', v_sub, 'discount_minor', v_disc, 'offer', v_off, 'payable_minor', greatest(v_sub - v_disc, 0), 'includes_table', v_bill.id is not null);
end $$;

create or replace function public_offers(p_cafe uuid) returns jsonb language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'details', o.details, 'kind', o.kind, 'rule', case when o.kind = 'info' then null else _offer_rule(o) end, 'valid_until', o.valid_until) order by o.created_at desc), '[]'::jsonb)
  from offers o where o.cafe_id = p_cafe and is_published(p_cafe) and _offer_live(o) $$;

-- 10) who may call what
revoke all on function _inr(bigint), _offer_live(offers), _offer_rule(offers), _offer_eval(uuid, jsonb), _bill_recalc(uuid), _price_lines(uuid, jsonb) from public, anon, authenticated;
revoke all on function pos_preview(uuid, text, jsonb), public_offers(uuid) from public, anon, authenticated;
grant execute on function pos_preview(uuid, text, jsonb), public_offers(uuid) to anon, authenticated;
select tablename from pg_tables where schemaname = 'public' and not rowsecurity;   -- CHECK: must return ZERO rows
