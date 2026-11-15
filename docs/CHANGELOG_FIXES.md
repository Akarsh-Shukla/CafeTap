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
Added on top: Swiggy-style "add ₹X more to unlock" hint, staff removal, register date lock, bill CSV export, onboarding docs.
