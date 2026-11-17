# What was fixed and where it is checked
| Problem found in review | Fix | Check |
|---|---|---|
| Receipt added tax in the browser; paid bills showed a balance | Tax is an inclusive breakup computed in SQL and frozen at payment; guest screen reads live payment state | `billing_tests` B14, B20, B21 |
| Anyone could read orders by guessing a 6-character reference | `get_public_bill` removed; receipts use a private 64-character link (7 days, read only) | B16 to B18, static check |
| Internal order function callable by anyone | Every function locked unless on an allow-list; old duplicate versions dropped | B1, `static.test.mjs` |
| Buy-1-get-1 made a single item free; guests chose offers; offers per order | Server picks the single best live offer per table bill; one unit is never free | B8 to B11 |
| Discount not kept on the bill when approving or cancelling | One recalculation function; discount locks after first payment | B12 to B15 |
| Add-ons accepted by name at zero price | Real add-on tables, required and maximum rules, sold-out and cross-café checks | B2 to B6 |
| Combos were a checkbox without contents | Combos with fixed contents, one price, sold out when a part is | B7 |
| Duplicate function versions (`pos_submit_order` etc.) | Dropped; static check forbids duplicates | `static.test.mjs` |
| Notifications were not real | Subscriptions, database trigger, Cloudflare function, installable app for staff only | B22, B23, `push.test.mjs` |
| Manifest and service worker loaded for customers; wrong icons | Loaded only on dashboard and admin; icons made from the logo | render test |
| QR codes with rounded corners did not scan; same icon for every café | Strong error correction, small logo, square corner frames, café logo; scanned by a decoder | tested with OpenCV |
| Public could read `owner_id` | Column access removed; explicit column lists | static check |
| Table sessions stayed usable after closing | Capabilities revoked on close; expiry always checked | manual (TEST_PLAN) |
| Backups workflow deleted, `vercel.json` left, dead files | Restored backup, CI added; dead files and unused packages removed | `static.test.mjs` |
| Page views stored one row each | One small counter row per café, day and kind | render test |
| Large photo uploads | Shrunk in the browser to 1000 px WebP | — |
| Order sheet overlapped the bottom bar and cart pill | The sheet now sits above them; the cart pill is centred without a clashing animation | checked on a phone-sized screen |
| QR posters blank on the live site | The security headers blocked the QR library's `data:` image read; headers fixed, and the poster retries without the centre image and shows a message instead of a blank square | reproduced and verified under the live headers |
| Tax section visible when tax was not enabled | Hidden unless the admin switched it on; nothing is shown on bills either | render test |
| Guest bill had no way back | Back and Close buttons, "Back to the menu", and in-app navigation | render test |
| Add button missing in the list view and oversized in cards | Compact Add or quantity control beside the price in both views | render test |\n| Running bill vanished when the guest left the page | Bill link kept on the device for 7 days; a bar at the top follows the guest until the table closes; ordering again joins the same bill | `billing_tests` B28, B29 |\nAdded on top: dish **versions** (Half/Full plate, Veg/Non-veg) that set the price, with a "from ₹…" price and a veg-only filter that understands them; a searchable, foldable menu editor; a **Sold out** screen for owners and every staff member (availability only); a quick-setup for common versions. Earlier additions: Swiggy-style "add ₹X more to unlock" hint, staff removal, register date lock, bill CSV export, onboarding docs.
