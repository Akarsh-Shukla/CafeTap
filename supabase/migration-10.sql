-- ============================================================================
-- migration-10: customer bills (live payment status, receipt link, café-set tax lines), single-call order board,
-- compact visit counters, push-notification subscriptions, export, and security hardening. Run after migrations 5 to 9.
-- ============================================================================
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cafe_members' and column_name = 'can_kitchen') then
    raise exception 'Run migrations 5 to 9 first in THIS project. Use supabase/check_setup.sql to see what is missing.';
  end if;
end $$;

-- 0) clean-up of an earlier draft of these features: its public bill lookup (order refs could be guessed) and its duplicate function versions
drop function if exists get_public_bill(text, text);
drop function if exists pos_order_status(text, text);   -- replaced by pos_my_bill, which uses an unguessable receipt token
drop function if exists pos_submit_order(text, text, jsonb, text, bigint, uuid);
drop function if exists pos_staff_add_order(uuid, uuid, text, jsonb, text, uuid);
drop function if exists _pos_create_order(uuid, uuid, text, text, jsonb, text, uuid, uuid, bigint, uuid);
drop function if exists pos_save_settings(uuid, boolean, boolean, double precision, double precision, integer, boolean, text, numeric, text, text);

-- 1) bill settings, bill numbers, receipts. Prices are TAX-INCLUSIVE: tax lines only show how much tax a bill already contains. Nothing is ever added on top.
create table if not exists cafe_bill_settings (
  cafe_id uuid primary key references cafes(id) on delete cascade,
  display_name text check (char_length(display_name) <= 80), address text check (char_length(address) <= 160), phone text check (char_length(phone) <= 20), footer text check (char_length(footer) <= 140),
  tax_feature_enabled boolean not null default false, tax_confirmed boolean not null default false, tax_lines jsonb not null default '[]', updated_at timestamptz not null default now(),
  check (jsonb_typeof(tax_lines) = 'array' and jsonb_array_length(tax_lines) <= 3));
create table if not exists cafe_counters (cafe_id uuid primary key references cafes(id) on delete cascade, last_bill_no int not null default 0);
alter table bills add column if not exists bill_no int, add column if not exists settled_at timestamptz, add column if not exists tax_rates jsonb;
create unique index if not exists bills_cafe_no on bills (cafe_id, bill_no) where bill_no is not null;
alter table order_capabilities add column if not exists receipt_hash text;
create unique index if not exists caps_receipt on order_capabilities (receipt_hash) where receipt_hash is not null;
create index if not exists payment_events_cafe_time on payment_events (cafe_id, recorded_at);
alter table cafe_bill_settings enable row level security; alter table cafe_counters enable row level security;
drop policy if exists "bill settings read" on cafe_bill_settings;
create policy "bill settings read" on cafe_bill_settings for select to authenticated using (is_admin() or staff_can(cafe_id, 'orders') or staff_can(cafe_id, 'payments'));

create or replace function _next_bill_no(p_cafe uuid) returns int language sql security definer set search_path = public as $$
  insert into cafe_counters (cafe_id, last_bill_no) values (p_cafe, 1) on conflict (cafe_id) do update set last_bill_no = cafe_counters.last_bill_no + 1 returning last_bill_no $$;

create or replace function bill_settings_save(p_cafe uuid, p_display text, p_address text, p_phone text, p_footer text, p_confirmed boolean, p_lines jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lines jsonb;
begin
  if not (owns_cafe(p_cafe) and cafe_has_pos(p_cafe)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 3 then return _fail('invalid'); end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e where jsonb_typeof(e) <> 'object' or coalesce(e->>'name', '') !~ '^[A-Za-z0-9 %().+/-]{1,20}$' or coalesce(e->>'rate', '') !~ '^[0-9]{1,2}(\.[0-9]{1,2})?$') then return _fail('invalid'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', btrim(e->>'name'), 'rate', round((e->>'rate')::numeric, 2))), '[]'::jsonb) into v_lines from jsonb_array_elements(p_lines) e;
  if (select coalesce(sum((e->>'rate')::numeric), 0) from jsonb_array_elements(v_lines) e) > 28 then return _fail('invalid'); end if;
  if jsonb_array_length(v_lines) > 0 and not coalesce((select tax_feature_enabled from cafe_bill_settings where cafe_id = p_cafe), false) then return _fail('tax_locked'); end if;   -- the platform admin switches tax lines on per café
  if jsonb_array_length(v_lines) > 0 and not coalesce(p_confirmed, false) then return _fail('confirm'); end if;
  insert into cafe_bill_settings (cafe_id, display_name, address, phone, footer, tax_confirmed, tax_lines, updated_at)
    values (p_cafe, nullif(left(btrim(coalesce(p_display, '')), 80), ''), nullif(left(btrim(coalesce(p_address, '')), 160), ''), nullif(left(btrim(coalesce(p_phone, '')), 20), ''), nullif(left(btrim(coalesce(p_footer, '')), 140), ''), coalesce(p_confirmed, false), v_lines, now())
    on conflict (cafe_id) do update set display_name = excluded.display_name, address = excluded.address, phone = excluded.phone, footer = excluded.footer, tax_confirmed = excluded.tax_confirmed, tax_lines = excluded.tax_lines, updated_at = now();
  perform _audit(p_cafe, 'pos', 'bill_settings.saved', null, jsonb_build_object('tax_lines', jsonb_array_length(v_lines)));
  return jsonb_build_object('ok', true);
end $$;

-- 2) payment now issues the bill number; sessions now hand the guest a read-only receipt key; staff_add no longer reveals which emails have logins
create or replace function pos_record_payment(p_bill uuid, p_amount bigint, p_method text, p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
declare b bills%rowtype;
begin
  select * into b from bills where id = p_bill;
  if b.id is null then raise exception 'not allowed' using errcode = '42501'; end if;
  perform _require(b.cafe_id, 'payments');
  select * into b from bills where id = p_bill for update;
  if p_method is null or p_method not in ('cash', 'upi') then return _fail('invalid'); end if;
  if b.status <> 'open' then return _fail('closed'); end if;
  if p_amount is null or p_amount <= 0 or p_amount > b.total_minor - b.paid_minor then return _fail('amount'); end if;
  insert into payment_events (cafe_id, bill_id, amount_minor, method, event_type, actor, note)
    values (b.cafe_id, b.id, p_amount, p_method, 'payment', auth.uid(), nullif(left(btrim(coalesce(p_note, '')), 140), ''));
  update bills set paid_minor = paid_minor + p_amount where id = b.id;
  -- first full payment: issue the bill number and freeze the tax rates that applied
  if b.paid_minor + p_amount >= b.total_minor and b.total_minor > 0 and b.bill_no is null then
    update bills set bill_no = _next_bill_no(b.cafe_id), settled_at = now(),
      tax_rates = coalesce((select case when tax_feature_enabled and tax_confirmed and jsonb_array_length(tax_lines) > 0 then tax_lines end from cafe_bill_settings where cafe_id = b.cafe_id), '[]'::jsonb) where id = b.id;   -- an empty list means "no tax when it was paid": later settings never change a paid bill
  end if;
  perform _audit(b.cafe_id, 'pos', 'payment.recorded', b.id::text, jsonb_build_object('method', p_method, 'amount_minor', p_amount));
  return jsonb_build_object('ok', true, 'balance_minor', b.total_minor - b.paid_minor - p_amount);
end $$;

create or replace function pos_start_session(p_cafe uuid, p_table text, p_lat double precision, p_lng double precision, p_accuracy double precision)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c cafes%rowtype; v_s cafe_pos_settings%rowtype; v_t cafe_tables%rowtype;
  v_dist double precision; v_token text; v_receipt text; v_exp timestamptz := now() + interval '45 minutes';
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
  insert into order_capabilities (cafe_id, table_id, token_hash, receipt_hash, expires_at)
    values (p_cafe, v_t.id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), encode(sha256(convert_to(v_receipt, 'UTF8')), 'hex'), v_exp);
  return jsonb_build_object('ok', true, 'capability', v_token, 'expires_at', v_exp, 'table', v_t.display_name, 'receipt', v_receipt);
end $$;

create or replace function staff_add(p_cafe uuid, p_email text, p_orders boolean, p_payments boolean, p_close boolean, p_reports boolean, p_kitchen boolean, p_register boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_pos boolean;
begin
  if not (owns_cafe(p_cafe) and exists (select 1 from cafes where id = p_cafe and not suspended)) then raise exception 'not allowed' using errcode = '42501'; end if;
  select (plan_tier = 'pos') into v_pos from cafes where id = p_cafe;
  select id into v_user from auth.users where lower(email) = lower(btrim(coalesce(p_email, ''))) and email_confirmed_at is not null;
  if v_user is null then return _fail('no_account'); end if;
  if v_user = (select owner_id from cafes where id = p_cafe) or exists (select 1 from admins where user_id = v_user) then return _fail('no_account'); end if;
  if exists (select 1 from cafe_members where user_id = v_user and cafe_id <> p_cafe) then return _fail('no_account'); end if;
  if (select count(*) from cafe_members where cafe_id = p_cafe) >= 15 and not exists (select 1 from cafe_members where cafe_id = p_cafe and user_id = v_user) then return _fail('limit'); end if;
  insert into cafe_members (cafe_id, user_id, active, can_orders, can_payments, can_close, can_reports, can_kitchen, can_register, created_by)
    values (p_cafe, v_user, true, v_pos and coalesce(p_orders, false), v_pos and coalesce(p_payments, false), v_pos and coalesce(p_close, false), v_pos and coalesce(p_reports, false),
            v_pos and coalesce(p_kitchen, false), (not v_pos) and coalesce(p_register, false), auth.uid())
    on conflict (user_id) do update set active = true, can_orders = excluded.can_orders, can_payments = excluded.can_payments, can_close = excluded.can_close,
      can_reports = excluded.can_reports, can_kitchen = excluded.can_kitchen, can_register = excluded.can_register;
  perform _audit(p_cafe, 'pos', 'member.added', v_user::text, '{}');
  return jsonb_build_object('ok', true);
end $$;

-- 3) one bill builder for guests (their own orders only) and staff (whole table)
create or replace function _bill_json(p_bill uuid, p_cap uuid) returns jsonb language plpgsql security definer stable set search_path = public as $$
declare b bills%rowtype; c cafes%rowtype; s cafe_bill_settings%rowtype; v_table text; v_lines jsonb; v_sub bigint; v_rates jsonb; v_sum numeric := 0; v_tax jsonb := '[]'::jsonb; v_taxsum bigint := 0; v_t bigint; e jsonb; v_methods jsonb; v_state text; v_orders jsonb;
begin
  select * into b from bills where id = p_bill; if b.id is null then return _fail('none'); end if;
  select * into c from cafes where id = b.cafe_id; select * into s from cafe_bill_settings where cafe_id = b.cafe_id;
  select t.display_name into v_table from table_sessions ts join cafe_tables t on t.id = ts.table_id where ts.id = b.session_id;
  select coalesce(jsonb_agg(jsonb_build_object('name', q.name, 'qty', q.qty, 'unit_minor', q.unit, 'total_minor', q.tot) order by q.name), '[]'::jsonb), coalesce(sum(q.tot), 0)
    into v_lines, v_sub
  from (select i.name_snapshot as name, i.unit_price_minor as unit, sum(i.quantity)::int as qty, sum(i.line_total_minor)::bigint as tot
        from order_items i join orders o on o.id = i.order_id
        where o.bill_id = p_bill and o.status not in ('pending', 'cancelled') and (p_cap is null or o.capability_id = p_cap) group by 1, 2) q;
  v_rates := coalesce(b.tax_rates, case when s.tax_feature_enabled and s.tax_confirmed and jsonb_array_length(s.tax_lines) > 0 then s.tax_lines end);
  if v_rates is not null then
    select coalesce(sum((x->>'rate')::numeric), 0) into v_sum from jsonb_array_elements(v_rates) x;
    if v_sum > 0 then
      for e in select value from jsonb_array_elements(v_rates) loop
        v_t := round(v_sub * (e->>'rate')::numeric / (100 + v_sum));
        v_tax := v_tax || jsonb_build_array(jsonb_build_object('name', e->>'name', 'rate', (e->>'rate')::numeric, 'amount_minor', v_t));
        v_taxsum := v_taxsum + v_t;
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
    'lines', v_lines, 'subtotal_minor', v_sub, 'tax', v_tax, 'taxable_minor', v_sub - v_taxsum, 'total_minor', v_sub,
    'payment', jsonb_build_object('state', v_state, 'methods', v_methods), 'orders', v_orders, 'guest_only', p_cap is not null);
end $$;

create or replace function pos_my_bill(p_receipt text) returns jsonb language plpgsql security definer stable set search_path = public as $$
declare cap order_capabilities%rowtype; v_bill uuid;
begin
  if p_receipt is null or char_length(p_receipt) <> 64 then return _fail('none'); end if;
  select * into cap from order_capabilities where receipt_hash = encode(sha256(convert_to(p_receipt, 'UTF8')), 'hex') and created_at > now() - interval '7 days';
  if cap.id is null then return _fail('none'); end if;
  select bill_id into v_bill from orders where capability_id = cap.id order by created_at desc limit 1;
  if v_bill is null then return _fail('none'); end if;
  return _bill_json(v_bill, cap.id);
end $$;

create or replace function pos_bill_view(p_bill uuid) returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_cafe uuid;
begin
  select cafe_id into v_cafe from bills where id = p_bill;
  if v_cafe is null or not (staff_can(v_cafe, 'orders') or staff_can(v_cafe, 'payments')) then raise exception 'not allowed' using errcode = '42501'; end if;
  return _bill_json(p_bill, null);
end $$;

-- 4) the staff board and kitchen screen refresh with ONE request instead of five
create or replace function pos_board(p_cafe uuid, p_view text default 'full') returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_front boolean := staff_can(p_cafe, 'orders'); v_kit boolean := staff_can(p_cafe, 'kitchen'); v_sess uuid[]; v_k boolean := (p_view = 'kitchen');
begin
  if not (v_front or v_kit) or (not v_k and not v_front) then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(array_agg(id), '{}') into v_sess from table_sessions where cafe_id = p_cafe and status = 'open';
  return jsonb_build_object('ok', true,
    'tables', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'is_active', is_active) order by created_at), '[]'::jsonb) from cafe_tables where cafe_id = p_cafe),
    'sessions', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'table_id', table_id, 'opened_at', opened_at)), '[]'::jsonb) from table_sessions where id = any(v_sess)),
    'bills', case when v_k then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'session_id', session_id, 'total_minor', total_minor, 'paid_minor', paid_minor, 'bill_no', bill_no)), '[]'::jsonb) from bills where session_id = any(v_sess)) end,
    'orders', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'session_id', session_id, 'ref', ref, 'status', status, 'source', source, 'note', note, 'total_minor', total_minor, 'created_at', created_at) order by created_at), '[]'::jsonb)
               from orders where session_id = any(v_sess) and (not v_k or status in ('received', 'preparing', 'ready'))),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('order_id', i.order_id, 'name_snapshot', i.name_snapshot, 'quantity', i.quantity, 'line_total_minor', i.line_total_minor)), '[]'::jsonb)
              from order_items i join orders o on o.id = i.order_id where o.session_id = any(v_sess) and (not v_k or o.status in ('received', 'preparing', 'ready'))),
    'payments', case when v_k then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'bill_id', p.bill_id, 'amount_minor', p.amount_minor, 'method', p.method, 'event_type', p.event_type, 'corrects', p.corrects, 'recorded_at', p.recorded_at, 'note', p.note) order by p.recorded_at), '[]'::jsonb)
              from payment_events p join bills b on b.id = p.bill_id where b.session_id = any(v_sess)) end);
end $$;

-- 5) visit counters: one small row per café, day and kind (instead of one row per page view), so the database stays tiny
create table if not exists page_counts (cafe_id uuid not null references cafes(id) on delete cascade, day date not null,
  kind text not null check (kind in ('visit','menu','offers','wifi','review','feedback')), n int not null default 0, primary key (cafe_id, day, kind));
alter table page_counts enable row level security;
drop policy if exists "owner reads counts" on page_counts;
create policy "owner reads counts" on page_counts for select to authenticated using (owns_cafe(cafe_id));
create or replace function track_event(p_cafe uuid, p_kind text) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('visit', 'menu', 'offers', 'wifi', 'review', 'feedback') or not is_published(p_cafe) then return; end if;
  insert into page_counts (cafe_id, day, kind, n) values (p_cafe, (now() at time zone 'Asia/Kolkata')::date, p_kind, 1)
    on conflict (cafe_id, day, kind) do update set n = page_counts.n + 1;
end $$;

-- 6) background notifications: devices subscribe here; a database trigger pings a small Cloudflare function (see docs/PUSH_SETUP.md)
create table if not exists app_settings (key text primary key, value text not null);
alter table app_settings enable row level security;   -- no policies: readable only by the database functions
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(), cafe_id uuid not null references cafes(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('front', 'kitchen', 'both')), endpoint text not null unique check (char_length(endpoint) <= 600), p256dh text not null, auth text not null,
  created_at timestamptz not null default now(), seen_at timestamptz not null default now());
alter table push_subscriptions enable row level security;   -- no policies: only the functions below touch it
create index if not exists push_subs_cafe on push_subscriptions (cafe_id, role);

create or replace function push_subscribe(p_cafe uuid, p_endpoint text, p_p256dh text, p_auth text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_front boolean := staff_can(p_cafe, 'orders'); v_kit boolean := staff_can(p_cafe, 'kitchen'); v_role text;
begin
  if auth.uid() is null or not (v_front or v_kit) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 600 or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then return _fail('invalid'); end if;
  v_role := case when v_front and v_kit then 'both' when v_front then 'front' else 'kitchen' end;
  if (select count(*) from push_subscriptions where user_id = auth.uid() and cafe_id = p_cafe and endpoint <> p_endpoint) >= 5 then return _fail('limit'); end if;
  insert into push_subscriptions (cafe_id, user_id, role, endpoint, p256dh, auth) values (p_cafe, auth.uid(), v_role, p_endpoint, p_p256dh, p_auth)
    on conflict (endpoint) do update set cafe_id = excluded.cafe_id, user_id = excluded.user_id, role = excluded.role, p256dh = excluded.p256dh, auth = excluded.auth, seen_at = now();
  return jsonb_build_object('ok', true, 'role', v_role);
end $$;
create or replace function push_unsubscribe(p_endpoint text) returns jsonb language plpgsql security definer set search_path = public as $$
begin delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid(); return jsonb_build_object('ok', true); end $$;

create or replace function notify_order_push() returns trigger language plpgsql security definer set search_path = public as $$
declare v_role text; v_url text; v_secret text; v_eps jsonb;
begin
  if tg_op = 'INSERT' then v_role := case when new.status = 'pending' then 'front' else 'kitchen' end;
  elsif new.status = 'received' and old.status = 'pending' then v_role := 'kitchen';
  else return null; end if;
  select value into v_url from app_settings where key = 'push_url'; select value into v_secret from app_settings where key = 'push_secret';
  if v_url is null or v_secret is null then return null; end if;
  select coalesce(jsonb_agg(endpoint), '[]'::jsonb) into v_eps from push_subscriptions where cafe_id = new.cafe_id and role in (v_role, 'both');
  if jsonb_array_length(v_eps) = 0 then return null; end if;
  perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret), body := jsonb_build_object('role', v_role, 'endpoints', v_eps));
  return null;
exception when others then return null;   -- a failed notification must never block an order
end $$;
drop trigger if exists orders_push on orders;
create trigger orders_push after insert or update of status on orders for each row execute function notify_order_push();

-- 7) bills export (a café keeps its own books), and retention that includes the new tables
create or replace function pos_bills_export(p_cafe uuid, p_from date, p_to date) returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  perform _require(p_cafe, 'reports');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 31 then return _fail('range'); end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((select jsonb_agg(r order by r.bill_no) from (
    select b.bill_no, b.settled_at, t.display_name as "table", b.total_minor,
      coalesce((select sum(amount_minor) from payment_events where bill_id = b.id and method = 'cash'), 0) as cash_minor,
      coalesce((select sum(amount_minor) from payment_events where bill_id = b.id and method = 'upi'), 0) as upi_minor,
      coalesce((select sum(round(b.total_minor * (x->>'rate')::numeric / (100 + z.sr))) from jsonb_array_elements(b.tax_rates) x, lateral (select sum((y->>'rate')::numeric) as sr from jsonb_array_elements(b.tax_rates) y) z), 0) as tax_minor
    from bills b join table_sessions ts on ts.id = b.session_id join cafe_tables t on t.id = ts.table_id
    where b.cafe_id = p_cafe and b.bill_no is not null and (b.settled_at at time zone 'Asia/Kolkata')::date between p_from and p_to limit 5000) r), '[]'::jsonb));
end $$;

create or replace function purge_old_data() returns jsonb language plpgsql security definer set search_path = public as $$
declare a int; b int; c int; d int; e int;
begin
  delete from table_sessions where status = 'closed' and closed_at < now() - interval '12 months'; get diagnostics a = row_count;
  delete from feedback where created_at < now() - interval '12 months'; get diagnostics b = row_count;
  delete from security_audit_events where at < now() - interval '12 months'; get diagnostics c = row_count;
  delete from page_events where created_at < now() - interval '120 days'; get diagnostics d = row_count;
  delete from page_counts where day < current_date - 400; delete from push_subscriptions where seen_at < now() - interval '90 days';
  delete from order_capabilities where created_at < now() - interval '30 days'; get diagnostics e = row_count;
  return jsonb_build_object('sessions', a, 'feedback', b, 'audit', c, 'events', d, 'capabilities', e);
end $$;

-- 8) security: public visitors can no longer read who owns a café (owner_id); everything else they need stays readable
revoke select on cafes from anon;
grant select (id, slug, name, tagline, about, hours, theme, logo_url, cover_url, settings, published, plan_tier, suspended, created_at, updated_at) on cafes to anon;


-- 8) kept from earlier work: owner unlink, staff removal, safer table closing, register date lock, admin tax switch, indexes
create or replace function admin_unlink_owner(p_cafe uuid) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  update cafes set owner_id = null where id = p_cafe;
  update cafe_admin set owner_email = null where cafe_id = p_cafe;
  perform _audit(p_cafe, 'platform', 'owner.unlinked', null, '{}');
  return jsonb_build_object('ok', true);
end $$;
create or replace function staff_remove(p_cafe uuid, p_member uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare m cafe_members%rowtype;
begin
  select * into m from cafe_members where id = p_member and cafe_id = p_cafe;
  if m.id is null or not (owns_cafe(p_cafe) and exists (select 1 from cafes where id = p_cafe and not suspended)) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from cafe_members where id = m.id;
  perform _audit(p_cafe, 'pos', 'member.removed', m.user_id::text, '{}');
  return jsonb_build_object('ok', true);
end $$;
create or replace function admin_set_tax_feature(p_cafe uuid, p_enabled boolean) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into cafe_bill_settings (cafe_id, tax_feature_enabled) values (p_cafe, coalesce(p_enabled, false))
    on conflict (cafe_id) do update set tax_feature_enabled = coalesce(p_enabled, false),
      tax_confirmed = case when coalesce(p_enabled, false) then cafe_bill_settings.tax_confirmed else false end,
      tax_lines = case when coalesce(p_enabled, false) then cafe_bill_settings.tax_lines else '[]'::jsonb end, updated_at = now();
  perform _audit(p_cafe, 'platform', 'tax_feature.updated', null, jsonb_build_object('enabled', coalesce(p_enabled, false)));
  return jsonb_build_object('ok', true);
end $$;
create or replace function pos_close_session(p_session uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare b bills%rowtype; s table_sessions%rowtype;
begin
  select * into b from bills where session_id = p_session;
  if b.id is null then raise exception 'not allowed' using errcode = '42501'; end if;
  perform _require(b.cafe_id, 'close');
  select * into b from bills where id = b.id for update;
  select * into s from table_sessions where id = p_session for update;
  if s.status <> 'open' or b.status <> 'open' then return _fail('closed'); end if;
  if exists (select 1 from orders where session_id = s.id and status in ('pending', 'received', 'preparing', 'ready')) then return _fail('open_orders'); end if;
  if b.total_minor <> b.paid_minor then return jsonb_build_object('ok', false, 'reason', 'unpaid', 'balance_minor', b.total_minor - b.paid_minor); end if;
  update table_sessions set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = s.id;
  update bills set status = 'closed', closed_at = now() where id = b.id;
  update order_capabilities set revoked = true where table_id = s.table_id and not revoked;   -- the next group at this table starts a fresh session
  perform _audit(b.cafe_id, 'pos', 'session.closed', s.id::text, jsonb_build_object('total_minor', b.total_minor));
  return jsonb_build_object('ok', true);
end $$;
create or replace function register_save(p_cafe uuid, p_day date, p_cash bigint, p_upi bigint, p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date; v_email text; v_note text := nullif(left(btrim(coalesce(p_note, '')), 140), '');
begin
  if not register_access(p_cafe) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_day is null or p_day > v_today or p_day < v_today - 400 then return _fail('invalid'); end if;
  if not owns_cafe(p_cafe) and p_day < v_today - 1 then return _fail('past_date_locked'); end if;   -- staff can only edit today and yesterday
  if p_cash is null or p_upi is null or p_cash < 0 or p_upi < 0 or p_cash > 100000000 or p_upi > 100000000 then return _fail('invalid'); end if;
  insert into sales_register (cafe_id, day, cash_minor, upi_minor, note, updated_by, updated_at) values (p_cafe, p_day, p_cash, p_upi, v_note, auth.uid(), now())
    on conflict (cafe_id, day) do update set cash_minor = excluded.cash_minor, upi_minor = excluded.upi_minor, note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  select email into v_email from auth.users where id = auth.uid();
  insert into sales_register_log (cafe_id, day, cash_minor, upi_minor, note, actor, actor_email) values (p_cafe, p_day, p_cash, p_upi, v_note, auth.uid(), v_email);
  return jsonb_build_object('ok', true);
end $$;
create index if not exists idx_orders_cafe_created on orders (cafe_id, created_at desc);
create index if not exists idx_orders_session on orders (session_id);
create index if not exists idx_orders_bill on orders (bill_id);
create index if not exists idx_order_items_order on order_items (order_id);
create index if not exists idx_payment_events_bill on payment_events (bill_id, recorded_at desc);
create index if not exists idx_table_sessions_open on table_sessions (cafe_id, table_id) where status = 'open';
revoke all on function admin_unlink_owner(uuid), staff_remove(uuid, uuid), admin_set_tax_feature(uuid, boolean) from public, anon, authenticated;
grant execute on function admin_unlink_owner(uuid), staff_remove(uuid, uuid), admin_set_tax_feature(uuid, boolean) to authenticated;
revoke all on function claim_cafe() from public, anon, authenticated; grant execute on function claim_cafe() to authenticated;   -- only a logged-in owner can claim their café

-- 9) who may call what
revoke all on function _next_bill_no(uuid), _bill_json(uuid, uuid), notify_order_push(), purge_old_data() from public, anon, authenticated;
revoke all on function pos_my_bill(text), track_event(uuid, text), pos_bill_view(uuid), pos_board(uuid, text), bill_settings_save(uuid, text, text, text, text, boolean, jsonb),
  push_subscribe(uuid, text, text, text), push_unsubscribe(text), pos_bills_export(uuid, date, date) from public, anon, authenticated;
grant execute on function pos_my_bill(text), track_event(uuid, text) to anon, authenticated;
grant execute on function pos_bill_view(uuid), pos_board(uuid, text), bill_settings_save(uuid, text, text, text, text, boolean, jsonb),
  push_subscribe(uuid, text, text, text), push_unsubscribe(text), pos_bills_export(uuid, date, date) to authenticated;

-- CHECK: must return ZERO rows
select tablename from pg_tables where schemaname = 'public' and not rowsecurity;
