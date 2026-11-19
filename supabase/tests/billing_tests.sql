-- ============================================================================
-- Billing tests: offers, add-ons, combos, discounted bills, receipts, tax, locked functions, push.
-- Run in the SQL Editor of a STAGING project after ALL migrations (schema.sql, 2 to 13).
-- It always ends with an "error" that lists every result: this is on purpose, it rolls back everything so nothing is kept.
-- Each line says PASS or FAIL. Not run by the author (no database was available): if a fixture line fails to insert, send me the message.
-- ============================================================================
do $$
declare
  v_out text := ''; r jsonb; v_o uuid; v_b bills%rowtype; v_n int; v_t text;
  owner uuid := 'a0000000-0000-0000-0000-00000000000a'; adm uuid := 'd0000000-0000-0000-0000-00000000000d'; other uuid := 'f0000000-0000-0000-0000-00000000000f';
  caf uuid := 'a1000000-0000-0000-0000-0000000000a1'; cafb uuid := 'b1000000-0000-0000-0000-0000000000b1';
  cat_c uuid := 'a3000000-0000-0000-0000-0000000000a3'; cat_b uuid := 'a3000000-0000-0000-0000-0000000000a4';
  coffee uuid := 'a4000000-0000-0000-0000-0000000000a4'; coffee2 uuid := 'a4000000-0000-0000-0000-0000000000a5'; cake uuid := 'a4000000-0000-0000-0000-0000000000a6'; tea uuid := 'a4000000-0000-0000-0000-0000000000a7'; combo uuid := 'a4000000-0000-0000-0000-0000000000b1';
  g_size uuid := 'a5000000-0000-0000-0000-000000000001'; g_extra uuid := 'a5000000-0000-0000-0000-000000000002';
  ad_large uuid := 'a6000000-0000-0000-0000-000000000001'; ad_small uuid := 'a6000000-0000-0000-0000-000000000002'; ad_xl uuid := 'a6000000-0000-0000-0000-000000000003'; ad_shot uuid := 'a6000000-0000-0000-0000-000000000004'; ad_b uuid := 'b6000000-0000-0000-0000-000000000001';
  t1 uuid := 'a2000000-0000-0000-0000-0000000000a1'; t2 uuid := 'a2000000-0000-0000-0000-0000000000a2'; t3 uuid := 'a2000000-0000-0000-0000-0000000000a3'; t4 uuid := 'a2000000-0000-0000-0000-0000000000a4'; t5 uuid := 'a2000000-0000-0000-0000-0000000000a5';
  cap_a uuid := 'ca000000-0000-0000-0000-00000000000a'; cap_b uuid := 'cb000000-0000-0000-0000-00000000000b';
  claim_owner text := '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}';
  line jsonb;
begin
  -- fixtures (as the database owner)
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
    ('00000000-0000-0000-0000-000000000000', owner, 'authenticated', 'authenticated', 'owner@test.local', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', adm, 'authenticated', 'authenticated', 'admin@test.local', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'ownerb@test.local', now(), now(), now());
  insert into admins (user_id) values (adm);
  insert into cafes (id, owner_id, slug, name, published, plan_tier) values (caf, owner, 'bill-test-a', 'Bill Test A', true, 'pos'), (cafb, 'b0000000-0000-0000-0000-00000000000b', 'bill-test-b', 'Bill Test B', true, 'pos');
  insert into cafe_pos_settings (cafe_id, dine_in_enabled, accepting_orders, lat, lng, radius_m) values (caf, true, true, 26.4499, 80.3319, 100);
  insert into cafe_tables (id, cafe_id, display_name, token) values (t1, caf, 'T1', 'billtok0000001'), (t2, caf, 'T2', 'billtok0000002'), (t3, caf, 'T3', 'billtok0000003'), (t4, caf, 'T4', 'billtok0000004'), (t5, caf, 'T5', 'billtok0000005');
  insert into menu_categories (id, cafe_id, name) values (cat_c, caf, 'Coffee'), (cat_b, caf, 'Bakes');
  insert into menu_items (id, cafe_id, category_id, name, price_paise) values (coffee, caf, cat_c, 'Coffee A', 10000), (coffee2, caf, cat_c, 'Coffee B', 15000), (cake, caf, cat_b, 'Cake', 20000), (tea, caf, cat_c, 'Tea', 5000);
  insert into menu_items (id, cafe_id, category_id, name, price_paise, is_combo) values (combo, caf, cat_b, 'Coffee and cake', 25000, true);
  insert into combo_items (cafe_id, combo_id, item_id, qty) values (caf, combo, coffee, 1), (caf, combo, cake, 1);
  insert into addon_groups (id, cafe_id, name, min_select, max_select) values (g_size, caf, 'Size', 1, 1), (g_extra, caf, 'Extras', 0, 2);
  insert into addons (id, group_id, cafe_id, name, price_minor, is_available) values (ad_large, g_size, caf, 'Large', 2000, true), (ad_small, g_size, caf, 'Small', 0, true), (ad_xl, g_size, caf, 'XL', 3000, false), (ad_shot, g_extra, caf, 'Extra shot', 3000, true);
  insert into item_addon_groups (cafe_id, item_id, group_id) values (caf, coffee, g_size), (caf, coffee, g_extra);
  insert into menu_items (id, cafe_id, category_id, name, price_paise) values ('a4000000-0000-0000-0000-0000000000c1', caf, cat_b, 'Pizza', 12000);
  insert into addon_groups (id, cafe_id, name, kind, min_select, max_select) values ('a5000000-0000-0000-0000-000000000003', caf, 'Portion', 'variant', 1, 1);
  insert into addons (id, group_id, cafe_id, name, price_minor, diet) values ('a6000000-0000-0000-0000-000000000005', 'a5000000-0000-0000-0000-000000000003', caf, 'Half', 8000, 'veg'), ('a6000000-0000-0000-0000-000000000006', 'a5000000-0000-0000-0000-000000000003', caf, 'Full', 15000, 'nonveg');
  insert into item_addon_groups (cafe_id, item_id, group_id) values (caf, 'a4000000-0000-0000-0000-0000000000c1', 'a5000000-0000-0000-0000-000000000003');
  insert into addon_groups (id, cafe_id, name) values ('b5000000-0000-0000-0000-000000000001', cafb, 'Other café group');
  insert into addons (id, group_id, cafe_id, name, price_minor) values (ad_b, 'b5000000-0000-0000-0000-000000000001', cafb, 'Other café add-on', 1);
  perform set_config('request.jwt.claims', claim_owner, true);

  -- B1 only the allow-listed functions can be called without logging in
  begin
    select string_agg(p.proname, ', ') into v_t from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype and has_function_privilege('anon', p.oid, 'execute')
        and p.prorettype <> 'event_trigger'::regtype and p.proname not in ('is_owner', 'is_published', 'is_admin', 'owns_cafe', 'cafe_has_pos', 'staff_can', 'register_access', 'table_label', 'pos_ordering_state', 'pos_start_session', 'pos_submit_order', 'pos_my_bill', 'pos_preview', 'public_offers', 'track_event');
    v_out := v_out || format(E'%s B1 anonymous visitors can only call the allow-list %s\n', case when v_t is null then 'PASS' else 'FAIL' end, coalesce('(extra: ' || v_t || ')', ''));
  exception when others then v_out := v_out || 'FAIL B1 error: ' || sqlerrm || E'\n'; end;

  -- B2 to B7 pricing: add-ons and combos are validated by the server
  begin r := _price_lines(caf, jsonb_build_array(jsonb_build_object('id', coffee, 'qty', 1, 'addons', jsonb_build_array('a6000000-0000-0000-0000-0000000000ff'))));
    v_out := v_out || format(E'%s B2 an unknown add-on is rejected, never priced at zero\n', case when not (r->>'ok')::boolean then 'PASS' else 'FAIL' end);
  exception when others then v_out := v_out || 'FAIL B2 error: ' || sqlerrm || E'\n'; end;
  begin r := _price_lines(caf, jsonb_build_array(jsonb_build_object('id', coffee, 'qty', 1)));
    v_out := v_out || format(E'%s B3 a required add-on group must be chosen (%s)\n', case when r->>'reason' = 'options' then 'PASS' else 'FAIL' end, r->>'reason');
  exception when others then v_out := v_out || 'FAIL B3 error: ' || sqlerrm || E'\n'; end;
  begin r := _price_lines(caf, jsonb_build_array(jsonb_build_object('id', coffee, 'qty', 2, 'addons', jsonb_build_array(ad_large, ad_shot))));
    v_out := v_out || format(E'%s B4 add-on prices are added by the server: 2 x (100 + 20 + 30) = 300 (got %s)\n', case when (r->>'ok')::boolean and (r->>'total_minor')::bigint = 30000 then 'PASS' else 'FAIL' end, r->>'total_minor');
  exception when others then v_out := v_out || 'FAIL B4 error: ' || sqlerrm || E'\n'; end;
  begin r := _price_lines(caf, jsonb_build_array(jsonb_build_object('id', coffee, 'qty', 1, 'addons', jsonb_build_array(ad_xl))));
    v_out := v_out || format(E'%s B5 a sold-out add-on is rejected\n', case when not (r->>'ok')::boolean then 'PASS' else 'FAIL' end);
  exception when others then v_out := v_out || 'FAIL B5 error: ' || sqlerrm || E'\n'; end;
  begin r := _price_lines(caf, jsonb_build_array(jsonb_build_object('id', coffee, 'qty', 1, 'addons', jsonb_build_array(ad_b))));
    v_out := v_out || format(E'%s B6 an add-on from another café is rejected\n', case when not (r->>'ok')::boolean then 'PASS' else 'FAIL' end);
  exception when others then v_out := v_out || 'FAIL B6 error: ' || sqlerrm || E'\n'; end;
  begin r := _price_lines(caf, jsonb_build_array(jsonb_build_object('id', combo, 'qty', 1)));
    v_n := jsonb_array_length(r->'lines'->0->'combo');
    update menu_items set is_available = false where id = cake;
    line := _price_lines(caf, jsonb_build_array(jsonb_build_object('id', combo, 'qty', 1)));
    update menu_items set is_available = true where id = cake;
    v_out := v_out || format(E'%s B7 a combo has one price (250), keeps its contents (%s items) and is sold out when a part is\n', case when (r->>'total_minor')::bigint = 25000 and v_n = 2 and not (line->>'ok')::boolean then 'PASS' else 'FAIL' end, v_n);
  exception when others then v_out := v_out || 'FAIL B7 error: ' || sqlerrm || E'\n'; end;

  -- B8 to B12 the offer engine
  begin
    insert into offers (cafe_id, title, kind, buy_qty, get_qty, scope, scope_ids) values (caf, 'Coffee BOGO', 'bogo', 1, 1, 'category', array[cat_c]);
    line := (select jsonb_build_object('item_id', coffee, 'category_id', cat_c, 'name', 'Coffee A', 'base_minor', 10000));
    v_out := v_out || format(E'%s B8 buy 1 get 1: one unit gets NO discount, two units free the cheapest one (100), three still one, four two (%s / %s / %s / %s)\n',
      case when _offer_eval(caf, jsonb_build_array(line || '{"qty":1,"total_minor":10000}')) is null
            and (_offer_eval(caf, jsonb_build_array(line || '{"qty":2,"total_minor":20000}'))->>'discount_minor')::bigint = 10000
            and (_offer_eval(caf, jsonb_build_array(line || '{"qty":3,"total_minor":30000}'))->>'discount_minor')::bigint = 10000
            and (_offer_eval(caf, jsonb_build_array(line || '{"qty":4,"total_minor":40000}'))->>'discount_minor')::bigint = 20000 then 'PASS' else 'FAIL' end,
      _offer_eval(caf, jsonb_build_array(line || '{"qty":1,"total_minor":10000}')) is null, _offer_eval(caf, jsonb_build_array(line || '{"qty":2,"total_minor":20000}'))->>'discount_minor',
      _offer_eval(caf, jsonb_build_array(line || '{"qty":3,"total_minor":30000}'))->>'discount_minor', _offer_eval(caf, jsonb_build_array(line || '{"qty":4,"total_minor":40000}'))->>'discount_minor');
    delete from offers where cafe_id = caf;
  exception when others then v_out := v_out || 'FAIL B8 error: ' || sqlerrm || E'\n'; end;
  begin
    insert into offers (cafe_id, title, kind, percent, min_subtotal_minor, max_discount_minor) values (caf, '10 percent', 'percent', 10, 50000, 10000);
    line := '{"item_id":null,"category_id":null,"name":"x","qty":1,"base_minor":1}'::jsonb;
    v_out := v_out || format(E'%s B9 10 percent needs a 500 minimum and is capped at 100 (400: %s, 600: %s, 1500: %s)\n',
      case when _offer_eval(caf, jsonb_build_array(line || '{"total_minor":40000}')) is null
            and (_offer_eval(caf, jsonb_build_array(line || '{"total_minor":60000}'))->>'discount_minor')::bigint = 6000
            and (_offer_eval(caf, jsonb_build_array(line || '{"total_minor":150000}'))->>'discount_minor')::bigint = 10000 then 'PASS' else 'FAIL' end,
      _offer_eval(caf, jsonb_build_array(line || '{"total_minor":40000}'))->>'discount_minor', _offer_eval(caf, jsonb_build_array(line || '{"total_minor":60000}'))->>'discount_minor', _offer_eval(caf, jsonb_build_array(line || '{"total_minor":150000}'))->>'discount_minor');
    insert into offers (cafe_id, title, kind, flat_minor, min_subtotal_minor) values (caf, 'Flat 50', 'flat', 5000, 30000);
    v_out := v_out || format(E'%s B10 flat 50 off needs a 300 minimum, and the best offer wins at 600 (10 percent = 60 beats flat 50)\n',
      case when (_offer_eval(caf, jsonb_build_array(line || '{"total_minor":25000}'))->>'discount_minor') is null
            and (_offer_eval(caf, jsonb_build_array(line || '{"total_minor":30000}'))->>'discount_minor')::bigint = 5000
            and (_offer_eval(caf, jsonb_build_array(line || '{"total_minor":60000}'))->>'title') = '10 percent' then 'PASS' else 'FAIL' end);
    delete from offers where cafe_id = caf;
    insert into offers (cafe_id, title, kind, percent, days) values (caf, 'Not today', 'percent', 50, array[((extract(dow from now() at time zone 'Asia/Kolkata')::int + 1) % 7)::smallint]);
    v_out := v_out || format(E'%s B11 an offer for other weekdays does not apply today\n', case when _offer_eval(caf, jsonb_build_array(line || '{"total_minor":60000}')) is null then 'PASS' else 'FAIL' end);
    delete from offers where cafe_id = caf;
  exception when others then v_out := v_out || 'FAIL B9-B11 error: ' || sqlerrm || E'\n'; end;

  -- B12 to B14 real bills: discount on the bill, cancel, payment, bill numbers, locked discount
  begin
    insert into offers (cafe_id, title, kind, percent, min_subtotal_minor) values (caf, '10 percent', 'percent', 10, 20000);
    r := _pos_create_order(caf, t2, 'staff', 'idem-test-b12-0000', jsonb_build_array(jsonb_build_object('id', coffee2, 'qty', 2)), '', null, owner, null);
    select * into v_b from bills where cafe_id = caf and total_minor > 0 order by created_at desc limit 1;
    v_out := v_out || format(E'%s B12 a counter order gets the offer on the table bill: 300 - 30 = 270 (subtotal %s, discount %s, total %s)\n', case when v_b.subtotal_minor = 30000 and v_b.discount_minor = 3000 and v_b.total_minor = 27000 and v_b.offer_snapshot->>'title' = '10 percent' then 'PASS' else 'FAIL' end, v_b.subtotal_minor, v_b.discount_minor, v_b.total_minor);
    select id into v_o from orders where bill_id = v_b.id limit 1;
    r := pos_set_order_status(v_o, 'cancelled'); select * into v_b from bills where id = v_b.id;
    v_out := v_out || format(E'%s B13 cancelling the order removes the discount too (total %s, discount %s)\n', case when v_b.total_minor = 0 and v_b.discount_minor = 0 then 'PASS' else 'FAIL' end, v_b.total_minor, v_b.discount_minor);
    r := _pos_create_order(caf, t3, 'staff', 'idem-test-b14a-0000', jsonb_build_array(jsonb_build_object('id', coffee2, 'qty', 2)), '', null, owner, null);
    select * into v_b from bills where cafe_id = caf and total_minor = 27000 order by created_at desc limit 1;
    r := pos_record_payment(v_b.id, 27000, 'cash', ''); select * into v_b from bills where id = v_b.id;
    v_out := v_out || format(E'%s B14 full payment issues bill number %s and the bill reads paid with no balance\n', case when v_b.bill_no is not null and (_bill_json(v_b.id, null)->'payment'->>'state') = 'paid' and v_b.paid_minor = v_b.total_minor then 'PASS' else 'FAIL' end, v_b.bill_no);
    r := _pos_create_order(caf, t4, 'staff', 'idem-test-b14b-0000', jsonb_build_array(jsonb_build_object('id', coffee2, 'qty', 2)), '', null, owner, null);
    select * into v_b from bills where cafe_id = caf and session_id = (select id from table_sessions where table_id = t4 and status = 'open');
    r := pos_record_payment(v_b.id, 1000, 'cash', '');
    r := _pos_create_order(caf, t4, 'staff', 'idem-test-b14c-0000', jsonb_build_array(jsonb_build_object('id', coffee2, 'qty', 2)), '', null, owner, null);
    select * into v_b from bills where id = v_b.id;
    v_out := v_out || format(E'%s B15 the discount is locked after the first payment: subtotal 600, discount stays 30, total 570 (got %s / %s / %s)\n', case when v_b.subtotal_minor = 60000 and v_b.discount_minor = 3000 and v_b.total_minor = 57000 then 'PASS' else 'FAIL' end, v_b.subtotal_minor, v_b.discount_minor, v_b.total_minor);
    delete from offers where cafe_id = caf;
  exception when others then v_out := v_out || 'FAIL B12-B15 error: ' || sqlerrm || E'\n'; end;

  -- B16 receipts: only the guest's own items, wrong or old links give nothing
  begin
    insert into order_capabilities (id, cafe_id, table_id, token_hash, receipt_hash, expires_at) values
      (cap_a, caf, t5, encode(sha256(convert_to('A' || repeat('a', 63), 'UTF8')), 'hex'), encode(sha256(convert_to(repeat('a', 64), 'UTF8')), 'hex'), now() + interval '1 hour'),
      (cap_b, caf, t5, encode(sha256(convert_to('B' || repeat('b', 63), 'UTF8')), 'hex'), encode(sha256(convert_to(repeat('b', 64), 'UTF8')), 'hex'), now() + interval '1 hour');
    r := _pos_create_order(caf, t5, 'customer', 'idem-test-b16a-0000', jsonb_build_array(jsonb_build_object('id', tea, 'qty', 1)), '', cap_a, null, null);
    r := _pos_create_order(caf, t5, 'customer', 'idem-test-b16b-0000', jsonb_build_array(jsonb_build_object('id', cake, 'qty', 1)), '', cap_b, null, null);
    for v_o in select id from orders where session_id = (select id from table_sessions where table_id = t5 and status = 'open') loop perform pos_set_order_status(v_o, 'received'); end loop;
    r := pos_my_bill(repeat('a', 64));
    v_out := v_out || format(E'%s B16 a guest sees only their own items (Tea) plus table totals when others ordered (%s item lines, shared=%s)\n', case when (r->>'ok')::boolean and jsonb_array_length(r->'lines') = 1 and r->'lines'->0->>'name' = 'Tea' and (r->>'shared')::boolean then 'PASS' else 'FAIL' end, jsonb_array_length(r->'lines'), r->>'shared');
    v_out := v_out || format(E'%s B17 a wrong receipt link returns nothing\n', case when not (pos_my_bill(repeat('c', 64))->>'ok')::boolean then 'PASS' else 'FAIL' end);
    update order_capabilities set created_at = now() - interval '8 days' where id = cap_a;
    v_out := v_out || format(E'%s B18 a receipt link older than 7 days returns nothing\n', case when not (pos_my_bill(repeat('a', 64))->>'ok')::boolean then 'PASS' else 'FAIL' end);
  exception when others then v_out := v_out || 'FAIL B16-B18 error: ' || sqlerrm || E'\n'; end;

  -- B28 to B29 the running bill: a second visit at the same table joins the first one, and closing the table ends it
  begin
    insert into order_capabilities (id, cafe_id, table_id, token_hash, receipt_hash, expires_at, receipt_group)
      values ('cc000000-0000-0000-0000-0000000000cc', caf, t5, encode(sha256(convert_to('C' || repeat('c', 63), 'UTF8')), 'hex'), encode(sha256(convert_to(repeat('d', 64), 'UTF8')), 'hex'), now() + interval '1 hour', coalesce((select receipt_group from order_capabilities where id = cap_a), gen_random_uuid()));
    r := _pos_create_order(caf, t5, 'customer', 'idem-test-b28-0000', jsonb_build_array(jsonb_build_object('id', tea, 'qty', 1)), '', 'cc000000-0000-0000-0000-0000000000cc', null, null);
    for v_o in select id from orders where session_id = (select id from table_sessions where table_id = t5 and status = 'open') and status = 'pending' loop perform pos_set_order_status(v_o, 'received'); end loop;
    r := pos_my_bill(repeat('d', 64));
    v_out := v_out || format(E'%s B28 a new link from the same guest shows both visits on one running bill (Tea x%s, open=%s)\n', case when (r->>'ok')::boolean and (r->'lines'->0->>'qty')::int = 2 and (r->>'open')::boolean then 'PASS' else 'FAIL' end, r->'lines'->0->>'qty', r->>'open');
    update bills set status = 'closed' where session_id = (select id from table_sessions where table_id = t5 and status = 'open');
    v_out := v_out || format(E'%s B29 once the table is closed the bill says it is no longer open\n', case when not (pos_my_bill(repeat('d', 64))->>'open')::boolean then 'PASS' else 'FAIL' end);
  exception when others then v_out := v_out || 'FAIL B28-B29 error: ' || sqlerrm || E'\n'; end;

  -- B19 to B21 tax: off until the admin allows it, inclusive breakup only, frozen when paid
  begin
    r := bill_settings_save(caf, '', '', '', '', true, '[{"name":"CGST","rate":"2.5"},{"name":"SGST","rate":"2.5"}]'::jsonb);
    v_out := v_out || format(E'%s B19 tax lines are refused until the admin switches them on (%s)\n', case when r->>'reason' = 'tax_locked' then 'PASS' else 'FAIL' end, r->>'reason');
    perform set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
    perform admin_set_tax_feature(caf, true);
    perform set_config('request.jwt.claims', claim_owner, true);
    r := bill_settings_save(caf, '', '', '', '', true, '[{"name":"CGST","rate":"2.5"},{"name":"SGST","rate":"2.5"}]'::jsonb);
    r := _pos_create_order(caf, t1, 'staff', 'idem-test-b20-0000', jsonb_build_array(jsonb_build_object('id', coffee2, 'qty', 2)), '', null, owner, null);
    select * into v_b from bills where session_id = (select id from table_sessions where table_id = t1 and status = 'open');
    perform pos_record_payment(v_b.id, 30000, 'upi', '');
    r := _bill_json(v_b.id, null);
    v_out := v_out || format(E'%s B20 tax is an inclusive breakup that adds up: 300 includes 2 x 7.14 and taxable value 285.72 (tax %s, taxable %s, total %s)\n',
      case when jsonb_array_length(r->'tax') = 2 and (r->'tax'->0->>'amount_minor')::bigint = 714 and (r->>'taxable_minor')::bigint = 28572 and (r->>'total_minor')::bigint = 30000 then 'PASS' else 'FAIL' end, r->'tax', r->>'taxable_minor', r->>'total_minor');
    update cafe_bill_settings set tax_lines = '[{"name":"VAT","rate":"20"}]'::jsonb where cafe_id = caf;
    v_out := v_out || format(E'%s B21 changing tax settings later does not change a bill that was already paid\n', case when (_bill_json(v_b.id, null)->'tax'->0->>'name') = 'CGST' then 'PASS' else 'FAIL' end);
  exception when others then v_out := v_out || 'FAIL B19-B21 error: ' || sqlerrm || E'\n'; end;

  -- B22 notifications never block an order, and only staff can subscribe
  begin
    insert into app_settings (key, value) values ('push_url', 'https://example.invalid/api/push-notify'), ('push_secret', 'test-secret') on conflict (key) do update set value = excluded.value;   -- rolled back at the end, your real settings are untouched
    r := push_subscribe(caf, 'https://fcm.googleapis.com/fcm/send/test-endpoint', 'p256dh-test', 'auth-test');
    r := jsonb_build_object('sub', r) || _pos_create_order(caf, t1, 'customer', 'idem-test-b22-0000', jsonb_build_array(jsonb_build_object('id', tea, 'qty', 1)), '', null, null, null);
    v_out := v_out || format(E'%s B22 an order still succeeds when the notification call fails\n', case when (r->>'ok')::boolean then 'PASS' else 'FAIL' end);
    perform set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-00000000000f","role":"authenticated"}', true);
    begin perform push_subscribe(caf, 'https://fcm.googleapis.com/fcm/send/intruder', 'p', 'a'); v_out := v_out || E'FAIL B23 a stranger could subscribe to a café\'s orders\n';
    exception when others then v_out := v_out || E'PASS B23 a stranger cannot subscribe to a café\'s orders\n'; end;
  exception when others then v_out := v_out || 'FAIL B22-B23 error: ' || sqlerrm || E'\n'; end;

  -- B24 to B27 versions of a dish and the sold-out switch
  begin
    r := _price_lines(caf, jsonb_build_array(jsonb_build_object('id', 'a4000000-0000-0000-0000-0000000000c1', 'qty', 2, 'addons', jsonb_build_array('a6000000-0000-0000-0000-000000000006'))));
    v_out := v_out || format(E'%s B24 a chosen version sets the price and shows in the name: 2 x Full 150 = 300 (%s, %s)\n', case when (r->>'total_minor')::bigint = 30000 and r->'lines'->0->>'name' = 'Pizza (Full)' then 'PASS' else 'FAIL' end, r->>'total_minor', r->'lines'->0->>'name');
    r := _price_lines(caf, jsonb_build_array(jsonb_build_object('id', 'a4000000-0000-0000-0000-0000000000c1', 'qty', 1)));
    v_out := v_out || format(E'%s B25 a dish with versions cannot be ordered without choosing one (%s)\n', case when r->>'reason' = 'options' then 'PASS' else 'FAIL' end, r->>'reason');
    perform set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-00000000000f","role":"authenticated"}', true);
    begin perform menu_set_availability(caf, 'item', tea, false); v_out := v_out || E'FAIL B26 a stranger could mark a dish sold out\n';
    exception when others then v_out := v_out || E'PASS B26 a stranger cannot mark a dish sold out\n'; end;
    perform set_config('request.jwt.claims', claim_owner, true);
    r := menu_set_availability(caf, 'item', tea, false);
    v_out := v_out || format(E'%s B27 the owner can mark a dish sold out, and guests then cannot order it\n', case when (r->>'ok')::boolean and not (_price_lines(caf, jsonb_build_array(jsonb_build_object('id', tea, 'qty', 1)))->>'ok')::boolean then 'PASS' else 'FAIL' end);
    perform menu_set_availability(caf, 'item', tea, true);
  exception when others then v_out := v_out || 'FAIL B24-B27 error: ' || sqlerrm || E'\n'; end;

  raise exception E'\n=== BILLING TESTS (everything was rolled back, nothing was saved) ===\n%\n=== end ===', v_out;
end $$;
