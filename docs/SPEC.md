# VaporFlow — Product & Technical Specification

Version 1.1 · 13 November 2026 · Status: approved for build

## 1. Purpose

VaporFlow is a point-of-sale (POS) system for a retail shop selling vapes, mobile accessories (cases, glass protectors, cables, chargers), headphones, watches and similar goods. It runs as a Windows desktop app and an Android app, works fully offline, and syncs automatically to a free cloud database when internet returns.

Priorities, in order:

1. A sale is never blocked (offline-first, fast).
2. Easy for a non-technical user: few screens, big buttons, scanner and keyboard friendly.
3. Data is never silently wrong or lost: immutable sales, append-only stock ledger, backups.
4. Universal: nothing is hardcoded for vapes, and every record carries a shop_id so more shops can be supported later. v1 serves exactly one shop with one PC, one phone and one user.

## 2. Locked technical decisions

- Language: TypeScript (strict) everywhere. Package manager: pnpm workspaces.
- UI: React + Vite + Tailwind CSS, one shared codebase for both platforms. HashRouter. State: Zustand. Validation: zod. Dates: date-fns. Charts: recharts. Date range picker: react-day-picker. Barcodes: jsbarcode. CSV: papaparse. IDs: UUID v7. Tests: vitest.
- Windows: Electron + electron-builder (NSIS installer). Chosen over Tauri because no Rust is needed, SQLite transactions through better-sqlite3 are simple and reliable, and silent printing for the future thermal printer is built in.
- Android: Capacitor. Camera scanning: @capacitor-mlkit/barcode-scanning.
- Local database: SQLite on both platforms (better-sqlite3 in the Electron main process via IPC; @capacitor-community/sqlite on Android) behind one DbAdapter interface.
- Cloud: Supabase free tier (Postgres + Auth). Only the anon key ships in the app; row-level security protects the data.
- Sync: custom client-side engine (section 7). No third-party sync service.

## 3. Scope

In v1:

- Products with variants and categories; barcode generation and printable labels; CSV import
- Sale screen with barcode scanner, cart, discount, Cash/Online payment
- Receipts (on screen, print, share), sales history, returns
- Stock: stock in, adjustments, movement history, low-stock alerts
- P&L report with a custom date range, plus simple expenses so net profit is meaningful
- Settings: shop info, optional logo, PIN lock, backup and restore
- Offline use with automatic sync between one PC and one phone

Not in v1 (the data model leaves room): customer credit (udhaar), suppliers and purchase orders, multiple users and roles, FBR/tax integration, silent thermal printing, product images, multi-shop UI, web dashboard.

## 4. Repository layout

- packages/core: domain types, zod schemas, money math, repositories, report queries, sync engine, SQL migrations. No UI and no platform code.
- packages/app: the shared React UI (all screens). Receives platform adapters through a provider.
- apps/desktop: Electron shell (main process, preload, DbAdapter, printing).
- apps/mobile: Capacitor shell (Android project, DbAdapter, camera scanner, share).
- supabase/migrations: Postgres schema, RLS policies, RPC functions.
- docs: this specification.

## 5. Platform adapters

Interfaces are defined in packages/core and implemented per platform:

- DbAdapter: query(sql, params) returns rows. batch(statements) runs all statements in ONE atomic transaction (all or nothing). migrate() applies ordered SQL files and records them in a _migrations table. Rule: every operation that must be atomic (complete sale, process return, stock adjustment, one CSV chunk) is built as a single batch. No interactive transactions.
- NetworkAdapter: isOnline(), onChange(callback).
- PrinterAdapter: printReceipt(html), printLabels(html). v1 opens the system print dialog; silent printing is a later setting.
- ShareAdapter: shareFile(name, data, mime). Android share sheet; on desktop it saves or opens the file.
- FileAdapter: export and import the backup file.
- ScannerAdapter (Android only): scanWithCamera() returns a barcode string.

## 6. Data model

Common columns on every synced table: id (TEXT, UUID v7, generated on the device), shop_id, created_at, updated_at (ISO 8601 UTC, set by the app on every change), deleted_at (null unless soft-deleted), device_id (device that created the row). Local SQLite also has dirty (0 or 1) and server_updated_at (copied from the server on pull). Postgres sets server_updated_at with a trigger on every insert and update.

Money: integers in the shop's smallest display unit (PKR: whole rupees, currency_decimals = 0). Never floats. Quantities are integers.

Mutable tables (last-write-wins by updated_at): shops, devices, categories, products, variants, expenses.

Ledger tables (insert-only, never updated and never hard-deleted): stock_movements, sales, sale_items, returns, return_items.

Tables (fields beyond the common columns):

- shops: name, address, phone, logo_base64 (nullable, max 150 KB, resized to 256 px), show_logo_on_receipt (default false), currency_code (default PKR), currency_decimals (default 0), receipt_footer (default 'Thank you for shopping with us'), default_low_stock_threshold (default 3)
- shop_members (Postgres only): shop_id, user_id, role ('owner')
- devices: name, code (2 to 4 letters, unique per shop, e.g. PC1, PH1), last_seen_at
- categories: name, sort_order
- products: category_id (nullable), name, brand (nullable), notes (nullable), is_active
- variants: product_id, name ('Default' for simple products), sku (nullable), barcode (nullable), cost_price (shown as 'Purchase price'), sale_price (shown as 'Selling price'), low_stock_threshold (nullable, null means use the shop default), track_stock (default true), is_active
- stock_movements: variant_id, qty_change (non-zero integer), type (opening | restock | adjustment | sale | return), ref_type and ref_id (nullable, point to a sale or return), unit_cost (nullable, restock only), note, occurred_at
- sales: receipt_no, sold_at, subtotal, discount_amount, total, payment_method (cash | online), amount_received (nullable, cash only), note
- sale_items: sale_id, variant_id, product_name and variant_name (snapshots), qty, list_price, unit_price (after any override), unit_cost (snapshot), net_total (line total after its share of the sale discount)
- returns: sale_id, returned_at, refund_amount, refund_method (cash | online), note
- return_items: return_id, sale_item_id, variant_id, qty, refund_amount, unit_cost (snapshot), restocked (boolean)
- expenses: expense_date (YYYY-MM-DD), amount, category (free text), note
- settings (local only, key/value): device_id, device_code, receipt_counter, pull cursors per table, pin_hash, last_sync_at

Indexes and views: unique barcode per shop among non-deleted variants (partial unique index); index on stock_movements(variant_id); index on sales(sold_at); view v_stock_on_hand = SUM(qty_change) per variant. Add a cached stock column only if this is proven slow.

## 7. Sync design

7.1 Principle. The app reads and writes only local SQLite. The cloud is a replica for backup and second-device sync and is never in the sale path.

7.2 Push. Rows with dirty = 1 are sent in batches of up to 200. Ledger rows are idempotent inserts (on conflict do nothing). Mutable rows go through a Postgres function that updates only if the incoming updated_at is newer than the stored one. On success the app clears dirty. Failures retry with exponential backoff and never create duplicates.

7.3 Pull. Per table, the app asks the server for rows after a cursor (server_updated_at, id) in pages of 500, ordered by that pair, implemented as an RPC function. On each pull the app subtracts 5 seconds from the stored cursor (rows are idempotent, so overlap is harmless) so rows committed out of order are not missed. Each page is applied in one batch. For mutable rows, a local row that is dirty and has a newer updated_at wins; otherwise the incoming row replaces it.

7.4 When sync runs. On app start; when the network returns; every 30 seconds while online; 2 seconds after a sale is saved; on the Sync now button. Only one sync runs at a time.

7.5 Status. A header indicator shows Synced, Pending (count), Offline or Error. Tapping it shows the last sync time, pending counts and a Sync problems list (rows the server rejected, for example the same barcode created on two devices while offline) where the user can fix the row and retry.

7.6 Stock convergence. Stock on hand is always the sum of movements. Because movements are insert-only and merged by id, two devices selling the same item offline converge to the correct total.

7.7 Onboarding and auth. First run offers two paths. (a) Set up new shop: creates the shop and device locally and the app is fully usable with no account. Later, Connect cloud sync in Settings: sign up or sign in (email and password), call claim_shop(shop_id) to create the membership, then push everything. (b) Sign in to existing shop (for the second device): needs internet once, signs in, registers a new device code, pulls everything, then works offline. Path (b) requires an empty device. After the first login the session is cached and the app keeps working offline.

7.8 Receipt numbers. receipt_no = device code + '-' + zero-padded counter (for example PC1-000123). The counter is per device. After a reinstall, the app sets the counter to the highest existing number for that device code plus one, after its first pull.

7.9 Clocks. updated_at relies on device clocks, which is acceptable for one owner and two devices. Reports use sold_at and returned_at, never sync times.

7.10 Free-tier safety. Supabase pauses idle free projects after about a week. Daily use prevents it, and a scheduled GitHub Action that pings the project weekly is a backstop. The app also offers a backup export so the cloud is never the only copy.

## 8. Business rules

1. Stock on hand = sum of qty_change. Negative stock is allowed: warn on the sale screen, never block the sale.
2. Sales are immutable. Mistakes are corrected with a return, not by editing or deleting.
3. Cost snapshot: sale_items.unit_cost = variant.cost_price at the time of sale. Later cost changes never alter past profit. In the UI, cost_price is labelled 'Purchase price' and sale_price 'Selling price'; both are mandatory when a variant is created, because daily sales and the P&L depend on them.
4. Discount is entered at sale level as an amount or a percent (percent is converted to an amount). It is allocated across lines in proportion to line gross, with the rounding remainder on the last line, and stored per line as net_total. A line's unit_price may be overridden; list_price keeps the original.
5. Returns: the local device permits at most the sold quantity less previous returns. For a sale line with cumulative returned quantity r, entitlement(r) = round(lineNetTotal × r / soldQty), to the nearest integer with exact halves toward positive infinity. Pay the cumulative entitlement less the amount actually refunded on previous returns of that line. Clamp the result to zero if it would reverse the sign of the original line. For two units with a line net total of 1 rupee, successive one-unit returns pay 1 and 0 rupees, for a total of 1. Ledger entries are immutable, including historical overpayments. Choose cash or online for the refund and whether to restock. Each restocked return adds a stock movement.
   If disconnected devices return the same line, both refunds and any restock movements remain in the ledger after sync. Sales displays a reconciliation warning identifying the receipt, item, sold quantity and returned quantity. The owner reconciles the discrepancy operationally.
6. Restock: movement type 'restock'. An optional new cost price updates variant.cost_price (last cost; no averaging in v1).
7. Adjustment: the user enters the counted quantity; the app writes the difference with a required note.
8. Low stock: on_hand <= (variant threshold, or the shop default). Out of stock: on_hand <= 0.
9. Payment methods are cash and online only.
10. Report formulas. The date range is inclusive, in local time, from 00:00:00 on the start day to 23:59:59.999 on the end day:
    - Net revenue = sum(sales.total by sold_at) minus sum(returns.refund_amount by returned_at)
    - Net COGS = sum(sale_items.qty x unit_cost by sold_at) minus sum(return_items.qty x unit_cost where restocked, by returned_at)
    - Gross profit = Net revenue minus Net COGS
    - Net profit = Gross profit minus sum(expenses.amount by expense_date)
    - Also: number of sales, average sale value, cash vs online split, top 10 items by quantity and by profit, daily revenue and profit chart
11. Timestamps are stored in UTC and shown in the device's local time.
12. Internal barcodes: EAN-13 with prefix 2 (reserved for in-store use) + 11 random digits + check digit, unique per shop.

## 9. Screens

9.1 Navigation. Desktop: left sidebar (Sale, Products, Stock, Sales, Reports, Expenses, Settings). Android: bottom bar (Sale, Products, Stock, Sales, More). Header shows the sync status. The Stock item shows a red badge with the count of low and out-of-stock variants.

9.2 Sale (main screen).

- Always-focused scan input. USB scanners type like a keyboard and press Enter. On Enter, an exact barcode match adds the item (quantity +1 if already in the cart) with a brief flash or beep. No match falls back to name/SKU search results. If still nothing, show 'Not found' with a button 'Create product with this barcode' that opens the product form prefilled.
- Focus returns to the scan input after any action unless a field is deliberately being edited. F2 focuses it.
- Cart lines: quantity plus, minus and typing; price override; remove; 'out of stock' warning chip.
- Discount (amount or %). Payment toggle Cash | Online (default Cash). For cash, optional Amount received with the change shown.
- Complete Sale (button or F9) runs one atomic batch, then opens the receipt. Esc clears the cart (asks to confirm if not empty).
- Android: a camera button next to the scan input. A USB scanner through an OTG adapter also works.

9.3 Receipt. 80 mm wide layout. Shows the logo (only if enabled and uploaded), shop name, address, phone, receipt number, date and time, line items (name, qty x price, line total), subtotal, discount, total, payment method and footer. Actions: Print (desktop), Share or save as PDF or image (Android), New sale.

9.4 Products. Search by name, SKU or barcode; category filter. Add and edit a product with a quick variants table (name, barcode, purchase price, selling price, low-stock threshold, opening stock). Purchase price and selling price are required for every variant and labelled exactly that way in the UI; the form shows the profit and margin per unit live and warns (does not block) when the selling price is below the purchase price. In barcode fields Enter moves to the next field and never submits the form. Generate barcode button. Labels: choose variants and print an A4 sheet (3 x 8) of barcode, name and price. Import CSV: template download, preview with row errors, import valid rows, re-import without duplicates (match on barcode, else product + variant name) with a choice to skip or update prices.

9.5 Stock. Table of variants with on-hand quantity; filter chips All, Low, Out, Negative; Stock In form (several lines, scan or search, quantity, optional new cost); Adjustment form; per-variant movement history. Low-stock alerts live here.

9.6 Sales history. Search by receipt number, filter by date. Open a sale to see its receipt, reprint it or start a return.

9.7 Reports (P&L). Date range with presets (Today, Yesterday, Last 7 days, This month, Last month) and a custom calendar range. Cards for net revenue, net COGS, gross profit, expenses, net profit, number of sales, average sale, cash vs online. Top 10 tables and a daily chart.

9.8 Expenses. Simple list and add form (date, amount, category text, note); edit and soft-delete.

9.9 Settings. Shop details and optional logo, show-logo toggle, receipt footer, default low-stock threshold, PIN lock (set, change, remove, auto-lock after N idle minutes), device name and code, cloud sync (connect, status, Sync now), backup export and restore (restore replaces local data after confirmation and marks every row dirty), app version, error log.

## 10. Security

- Only the Supabase anon key is in the app. The service_role key is never used or stored in the repo.
- Row-level security on every table: a row is accessible only if its shop_id is in the user's shop_members. claim_shop creates a membership only if that shop_id does not yet exist in the cloud.
- Local data is not encrypted in v1 (known limitation). The PIN lock only deters casual access.
- Electron: contextIsolation on, nodeIntegration off, typed preload API only.

## 11. Quality bar (definition of done for v1)

- A sale completes in under 1 second offline. Scan to cart is under 200 ms. The app stays smooth with 10,000 variants and 100,000 stock movements.
- Unit tests cover money and discount allocation, returns, stock on hand, report formulas and sync merge scenarios. Lint, typecheck and tests pass with no console errors.
- Manual hardware checks:
  1. The USB scanner types the barcode followed by Enter into Notepad.
  2. Scanning adds items to the cart on the PC.
  3. The scanner through an OTG adapter and the phone camera both work on Android.
  4. A receipt prints through the Windows print dialog at 80 mm width.
  5. Airplane-mode test: sell on both devices for an hour, reconnect, and stock and totals match on both.
  6. Kill the app mid-sale: no half-written sale exists afterwards.
  7. Backup, then restore on a clean install.

## 12. Known risks

- The native SQLite module (better-sqlite3) must be rebuilt for each Electron version; keep @electron/rebuild in the build scripts.
- Keyboard-style scanners inside the Android WebView can shift focus or pop up the on-screen keyboard; test early with the real scanner.
- Sync is the hardest part, so it has its own phase and simulated two-device tests.
- Free-tier limits can change; backups mitigate this.
- The same barcode created on two devices while offline is rejected by the server for the second device and appears in Sync problems.
- No tax integration and no thermal printing yet.

## 13. Later versions

Customer credit, suppliers and purchase orders, multi-user roles, FBR integration, thermal printer (ESC/POS) with silent printing, multi-shop and web dashboard, product images, weighted-average cost.

22 November 2026 · Section 8.5 clarified cumulative refund rounding and offline over-return reconciliation.
