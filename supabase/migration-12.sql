-- ============================================================================
-- migration-12: versions of a dish (Half/Full plate, Veg/Non-veg) that set the price, "sold out" switch for any staff member,
-- and the café address on the guest bill (for its back button). Run after migration-11.
-- ============================================================================
do $$ begin if to_regclass('public.addon_groups') is null then raise exception 'Run migrations up to 11 first in THIS project (see supabase/check_setup.sql).'; end if; end $$;

alter table addon_groups add column if not exists kind text not null default 'addon';
alter table addon_groups drop constraint if exists addon_groups_kind_check; alter table addon_groups add constraint addon_groups_kind_check check (kind in ('addon', 'variant'));
alter table addon_groups drop constraint if exists variant_rules; alter table addon_groups add constraint variant_rules check (kind <> 'variant' or (min_select = 1 and max_select = 1));   -- a version is always "choose exactly one"
alter table addons add column if not exists diet text;
alter table addons drop constraint if exists addons_diet_check; alter table addons add constraint addons_diet_check check (diet is null or diet in ('veg', 'nonveg', 'egg'));
alter table addons drop constraint if exists addons_price_minor_check; alter table addons add constraint addons_price_minor_check check (price_minor between 0 and 1000000);

create or replace function chk_cafe_links() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'combo_items' then
    if not exists (select 1 from menu_items a join menu_items b on b.cafe_id = a.cafe_id where a.id = new.combo_id and a.is_combo and a.cafe_id = new.cafe_id and b.id = new.item_id and not b.is_combo) then raise exception 'invalid combo'; end if;
  elsif tg_table_name = 'item_addon_groups' then
    if not exists (select 1 from menu_items m join addon_groups g on g.cafe_id = m.cafe_id where m.id = new.item_id and g.id = new.group_id and m.cafe_id = new.cafe_id) then raise exception 'invalid link'; end if;
    if exists (select 1 from addon_groups g where g.id = new.group_id and g.kind = 'variant')
       and exists (select 1 from item_addon_groups l join addon_groups g2 on g2.id = l.group_id where l.item_id = new.item_id and g2.kind = 'variant' and l.group_id <> new.group_id) then raise exception 'a dish can have only one set of versions'; end if;
  elsif tg_table_name = 'addons' then
    if not exists (select 1 from addon_groups g where g.id = new.group_id and g.cafe_id = new.cafe_id) then raise exception 'invalid add-on'; end if;
  end if;
  return new;
end $$;

-- pricing: a chosen version replaces the dish price; its name is shown on the kitchen screen and the bill, like "Farmhouse Pizza (Half)"
create or replace function _price_lines(p_cafe uuid, p_items jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record; m record; v_lines jsonb := '[]'::jsonb; v_bad jsonb := '[]'::jsonb; v_opt jsonb := '[]'::jsonb; v_addons jsonb; v_asum bigint; v_cnt int; v_combo jsonb; v_allok boolean; v_total bigint := 0; v_qty int := 0; v_unit bigint; v_tot bigint;
  v_uuid text := '^[0-9a-fA-F-]{36}$'; v_base bigint; v_vprice bigint; v_vname text; v_name text;
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
    v_addons := '[]'::jsonb; v_asum := 0; v_base := m.price_paise; v_vname := null; v_vprice := null; v_name := m.name;
    if cardinality(r.adds) > 0 then
      -- a "version" (Half/Full plate, Veg/Non-veg) SETS the price; ordinary add-ons are ADDED to it
      select coalesce(jsonb_agg(jsonb_build_object('id', ad.id, 'name', ad.name, 'price_minor', ad.price_minor) order by ad.name) filter (where g.kind = 'addon'), '[]'::jsonb),
             coalesce(sum(ad.price_minor) filter (where g.kind = 'addon'), 0), count(*), max(ad.price_minor) filter (where g.kind = 'variant'), max(ad.name) filter (where g.kind = 'variant')
        into v_addons, v_asum, v_cnt, v_vprice, v_vname
        from addons ad join addon_groups g on g.id = ad.group_id
        where ad.id = any(r.adds) and ad.cafe_id = p_cafe and ad.is_available and exists (select 1 from item_addon_groups ig where ig.item_id = m.id and ig.group_id = ad.group_id);
      if v_cnt <> cardinality(r.adds) then v_bad := v_bad || to_jsonb(m.name); continue; end if;
      if v_vprice is not null then v_base := v_vprice; v_name := m.name || ' (' || v_vname || ')'; end if;
    end if;
    if exists (select 1 from item_addon_groups ig join addon_groups g on g.id = ig.group_id where ig.item_id = m.id and
        ((select count(*) from addons a2 where a2.group_id = g.id and a2.id = any(r.adds)) < g.min_select or (select count(*) from addons a2 where a2.group_id = g.id and a2.id = any(r.adds)) > g.max_select)) then
      v_opt := v_opt || to_jsonb(m.name); continue;
    end if;
    v_unit := v_base + v_asum; v_tot := v_unit * r.qty; v_total := v_total + v_tot; v_qty := v_qty + r.qty;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('item_id', m.id, 'category_id', m.category_id, 'name', v_name, 'qty', r.qty, 'base_minor', v_base, 'addons_minor', v_asum,
                'unit_minor', v_unit, 'total_minor', v_tot, 'addons', v_addons, 'combo', v_combo));
  end loop;
  if jsonb_array_length(v_bad) > 0 then return jsonb_build_object('ok', false, 'reason', 'unavailable', 'names', v_bad); end if;
  if jsonb_array_length(v_opt) > 0 then return jsonb_build_object('ok', false, 'reason', 'options', 'names', v_opt); end if;
  if v_qty > 60 or v_total > 10000000 then return _fail('invalid'); end if;
  return jsonb_build_object('ok', true, 'lines', v_lines, 'total_minor', v_total);
exception when data_exception then return _fail('invalid');
end $$;

-- the guest bill knows its café, so "Back to the menu" works
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
    'cafe', jsonb_build_object('slug', c.slug, 'name', coalesce(nullif(s.display_name, ''), c.name), 'address', coalesce(s.address, c.settings->>'address'), 'phone', coalesce(s.phone, c.settings->>'phone'), 'footer', s.footer, 'theme', c.theme, 'design', coalesce(c.settings->'design', '{}'::jsonb)),
    'bill_no', b.bill_no, 'label', case when b.bill_no is null then null else 'B-' || lpad(b.bill_no::text, 5, '0') end, 'date', coalesce(b.settled_at, b.created_at), 'table', v_table,
    'lines', v_lines, 'subtotal_minor', v_view_sub, 'bill_subtotal_minor', v_all_sub, 'discount_minor', b.discount_minor, 'offer', b.offer_snapshot, 'total_minor', b.total_minor,
    'tax', v_tax, 'taxable_minor', b.total_minor - v_taxsum, 'payment', jsonb_build_object('state', v_state, 'methods', v_methods), 'orders', v_orders, 'shared', v_shared, 'guest_only', p_cap is not null);
end $$;

-- any member of a café (owner or staff) can mark a dish or an add-on sold out or available again. Nothing else about the menu can be changed this way.
create or replace function menu_set_availability(p_cafe uuid, p_kind text, p_id uuid, p_available boolean) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_available is null or p_kind not in ('item', 'addon') then return _fail('invalid'); end if;
  if not exists (select 1 from cafes c where c.id = p_cafe and not c.suspended and (c.owner_id = auth.uid() or exists (select 1 from cafe_members m where m.cafe_id = p_cafe and m.user_id = auth.uid()))) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind = 'item' then update menu_items set is_available = p_available where id = p_id and cafe_id = p_cafe;
  else update addons set is_available = p_available where id = p_id and cafe_id = p_cafe; end if;
  if not found then return _fail('none'); end if;
  perform _audit(p_cafe, 'menu', 'availability.' || p_kind, p_id::text, jsonb_build_object('available', p_available));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function menu_set_availability(uuid, text, uuid, boolean) from public, anon, authenticated;
grant execute on function menu_set_availability(uuid, text, uuid, boolean) to authenticated;

select tablename from pg_tables where schemaname = 'public' and not rowsecurity;   -- CHECK: must return ZERO rows
