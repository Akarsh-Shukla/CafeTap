-- ============================================================================
-- migration-13: a guest's running bill. Ordering again at the same table (even after the app was closed) adds to the same bill view,
-- and the bill says whether the table is still open. Run after migration-12. Safe to run again.
-- ============================================================================
do $$ begin if to_regprocedure('menu_set_availability(uuid,text,uuid,boolean)') is null then raise exception 'Run migrations up to 12 first in THIS project (see supabase/check_setup.sql).'; end if; end $$;

alter table order_capabilities add column if not exists receipt_group uuid not null default gen_random_uuid();
create index if not exists caps_group on order_capabilities (receipt_group);

drop function if exists pos_start_session(uuid, text, double precision, double precision, double precision);
create or replace function pos_start_session(p_cafe uuid, p_table text, p_lat double precision, p_lng double precision, p_accuracy double precision, p_prev_receipt text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c cafes%rowtype; v_s cafe_pos_settings%rowtype; v_t cafe_tables%rowtype;
  v_dist double precision; v_token text; v_receipt text; v_group uuid; v_exp timestamptz := now() + interval '45 minutes';
begin
  if p_cafe is null or p_table is null or char_length(p_table) > 64 then return _fail('unavailable'); end if;
  select * into v_c from cafes where id = p_cafe and published and plan_tier = 'pos' and not suspended;
  select * into v_s from cafe_pos_settings where cafe_id = p_cafe;
  select * into v_t from cafe_tables where cafe_id = p_cafe and token = p_table and is_active;
  if v_c.id is null or v_s.cafe_id is null or v_t.id is null or not v_s.dine_in_enabled or not v_s.accepting_orders or v_s.lat is null or v_s.lng is null then
    return _fail('unavailable');
  end if;
  delete from order_capabilities where expires_at < now() - interval '1 day';
  if (select count(*) from order_capabilities where table_id = v_t.id and created_at > now() - interval '10 minutes') >= 25
     or (select count(*) from order_capabilities where cafe_id = p_cafe and created_at > now() - interval '10 minutes') >= 200 then
    return _fail('rate');
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then return _fail('location'); end if;
  if p_accuracy is null or p_accuracy < 0 or p_accuracy > 150 then return _fail('accuracy'); end if;
  v_dist := _distance_m(p_lat, p_lng, v_s.lat, v_s.lng);
  if v_dist > v_s.radius_m then
    if (select count(*) from security_audit_events where cafe_id = p_cafe and action = 'pos.proximity_denied' and at > now() - interval '1 hour') < 50 then
      insert into security_audit_events (cafe_id, actor, category, action, target, meta) values (p_cafe, null, 'pos', 'pos.proximity_denied', v_t.display_name, '{}');
    end if;
    return _fail('outside');
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');   -- 64 hex chars, only its hash is stored
  v_receipt := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');   -- read-only key for the guest's bill link
  -- a guest who orders again at the same table keeps one running bill: the new link joins the old one's group
  if p_prev_receipt is not null and char_length(p_prev_receipt) = 64 then
    select receipt_group into v_group from order_capabilities where receipt_hash = encode(sha256(convert_to(p_prev_receipt, 'UTF8')), 'hex') and table_id = v_t.id and cafe_id = p_cafe and created_at > now() - interval '7 days';
  end if;
  insert into order_capabilities (cafe_id, table_id, token_hash, receipt_hash, expires_at, receipt_group)
    values (p_cafe, v_t.id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), encode(sha256(convert_to(v_receipt, 'UTF8')), 'hex'), v_exp, coalesce(v_group, gen_random_uuid()));
  return jsonb_build_object('ok', true, 'capability', v_token, 'expires_at', v_exp, 'table', v_t.display_name, 'receipt', v_receipt);
end $$;
revoke all on function pos_start_session(uuid, text, double precision, double precision, double precision, text) from public, anon, authenticated;
grant execute on function pos_start_session(uuid, text, double precision, double precision, double precision, text) to anon, authenticated;

create or replace function _bill_json(p_bill uuid, p_cap uuid) returns jsonb language plpgsql security definer stable set search_path = public as $$
declare b bills%rowtype; c cafes%rowtype; s cafe_bill_settings%rowtype; v_table text; v_lines jsonb; v_view_sub bigint; v_all_sub bigint; v_shared boolean; v_rates jsonb; v_sum numeric := 0; v_tax jsonb := '[]'::jsonb; v_taxsum bigint := 0; v_t bigint; e jsonb; v_methods jsonb; v_state text; v_orders jsonb;
begin
  select * into b from bills where id = p_bill; if b.id is null then return _fail('none'); end if;
  select * into c from cafes where id = b.cafe_id; select * into s from cafe_bill_settings where cafe_id = b.cafe_id;
  select t.display_name into v_table from table_sessions ts join cafe_tables t on t.id = ts.table_id where ts.id = b.session_id;
  select coalesce(jsonb_agg(jsonb_build_object('name', q.name, 'qty', q.qty, 'unit_minor', q.unit, 'total_minor', q.tot, 'addons', q.addons, 'combo', q.combo) order by q.name), '[]'::jsonb), coalesce(sum(q.tot), 0)
    into v_lines, v_view_sub
  from (select i.name_snapshot as name, i.unit_price_minor as unit, i.addons, i.combo, sum(i.quantity)::int as qty, sum(i.line_total_minor)::bigint as tot
        from order_items i join orders o on o.id = i.order_id where o.bill_id = p_bill and o.status not in ('pending', 'cancelled') and (p_cap is null or o.capability_id in (select c.id from order_capabilities c where c.receipt_group = p_cap))
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
  select coalesce(jsonb_agg(jsonb_build_object('ref', o.ref, 'status', o.status) order by o.created_at), '[]'::jsonb) into v_orders from orders o where o.bill_id = p_bill and (p_cap is null or o.capability_id in (select c.id from order_capabilities c where c.receipt_group = p_cap));
  return jsonb_build_object('ok', true,
    'cafe', jsonb_build_object('slug', c.slug, 'name', coalesce(nullif(s.display_name, ''), c.name), 'address', coalesce(s.address, c.settings->>'address'), 'phone', coalesce(s.phone, c.settings->>'phone'), 'footer', s.footer, 'theme', c.theme, 'design', coalesce(c.settings->'design', '{}'::jsonb)),
    'bill_no', b.bill_no, 'label', case when b.bill_no is null then null else 'B-' || lpad(b.bill_no::text, 5, '0') end, 'date', coalesce(b.settled_at, b.created_at), 'table', v_table,
    'lines', v_lines, 'subtotal_minor', v_view_sub, 'bill_subtotal_minor', v_all_sub, 'discount_minor', b.discount_minor, 'offer', b.offer_snapshot, 'total_minor', b.total_minor,
    'tax', v_tax, 'taxable_minor', b.total_minor - v_taxsum, 'payment', jsonb_build_object('state', v_state, 'methods', v_methods), 'orders', v_orders, 'shared', v_shared, 'guest_only', p_cap is not null, 'open', (b.status = 'open'));
end $$;

create or replace function pos_my_bill(p_receipt text) returns jsonb language plpgsql security definer stable set search_path = public as $$
declare cap order_capabilities%rowtype; v_bill uuid;
begin
  if p_receipt is null or char_length(p_receipt) <> 64 then return _fail('none'); end if;
  select * into cap from order_capabilities where receipt_hash = encode(sha256(convert_to(p_receipt, 'UTF8')), 'hex') and created_at > now() - interval '7 days';
  if cap.id is null then return _fail('none'); end if;
  select o.bill_id into v_bill from orders o where o.capability_id in (select c.id from order_capabilities c where c.receipt_group = cap.receipt_group) order by o.created_at desc limit 1;
  if v_bill is null then return _fail('none'); end if;
  return _bill_json(v_bill, cap.receipt_group);   -- the guest's orders from every visit to this table, on the table's current bill
end $$;

select tablename from pg_tables where schemaname = 'public' and not rowsecurity;   -- CHECK: must return ZERO rows
