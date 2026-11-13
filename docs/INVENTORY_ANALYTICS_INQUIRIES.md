# Inventory, Analytics & Inquiries — API Reference

> **Author:** Nikhil Telkar (Developer 3)  
> **Branch:** `feature/nikhil_telkar-inventory-analytics`  
> **Migrations:** 030 · 031 · 032

---

## Overview

This module adds three capabilities to the KalaSetu API:

1. **Atomic Stock Ledger** — every stock change goes through one Postgres function (`adjust_stock`) that locks the product row, validates the delta, updates stock, and records an immutable `stock_movements` audit trail in a single transaction.
2. **Inventory Analytics** — two Postgres views (`v_artisan_inventory_summary`, `v_daily_stock_movements`) push aggregation into the database; the service falls back to JavaScript computation when the views have not been applied yet.
3. **Buyer Inquiries** — artisans can send enquiries on Bazaar listings; the sender identity comes from the JWT, never from the request body; duplicate and self-inquiry guards are enforced server-side.

---

## Database Migrations

### 030 — `030_stock_ledger.sql`

| Object | Purpose |
|--------|---------|
| `CHECK stock_movements_reason_check` | Restricts `reason` to `voice`, `manual`, `order`, `sync` |
| `FUNCTION adjust_stock(...)` | Atomic stock adjustment: locks row `FOR UPDATE`, validates delta, updates `products.stock_quantity`, inserts `stock_movements` row |
| `REVOKE EXECUTE ... FROM public, anon, authenticated` | Only `service_role` may call the function |

### 031 — `031_analytics_views.sql`

| Object | Purpose |
|--------|---------|
| `INDEX stock_movements_artisan_created_idx` | `(artisan_id, created_at DESC)` for fast range queries |
| `VIEW v_artisan_inventory_summary` | Per-artisan rollup: total products, stock units, retail/wholesale value, low-stock and out-of-stock counts |
| `VIEW v_daily_stock_movements` | Daily aggregation by artisan, date (IST), and reason: movement count, total delta, units added, units sold |

### 032 — `032_inquiry_status.sql`

| Object | Purpose |
|--------|---------|
| `COLUMN buyer_artisan_id` | FK → `artisans(id) ON DELETE SET NULL`; links the inquiry to the registered buyer |
| `COLUMN status_updated_at` | Timestamp tracking when inquiry status last changed |
| `CHECK buyer_inquiries_status_check` | Restricts `status` to `new`, `replied`, `won`, `lost` |
| `INDEX buyer_inquiries_artisan_status_idx` | `(artisan_id, status, created_at DESC)` for fast inbox filtering |
| `INDEX buyer_inquiries_buyer_artisan_idx` | `(buyer_artisan_id, created_at DESC) WHERE buyer_artisan_id IS NOT NULL` |
| `POLICY inquiries_buyer_access` | RLS: buyers can `SELECT` inquiries they sent |

---

## API Endpoints

### Inventory

#### `GET /v1/inventory`

Returns the signed-in artisan's product inventory. **Changed:** now filters out soft-deleted products (`deleted_at IS NULL`).

#### `PATCH /v1/inventory/:productId/stock`

Adjusts stock for one product. **Changed:** now routes through the atomic `adjust_stock` ledger function (RPC) with a manual fallback if the migration has not been applied.

**Body:**
```json
{ "delta": -3 }
// OR
{ "quantity": 10 }
```

#### `POST /v1/inventory/voice-adjust`

Parses a spoken transcript, matches a product, and adjusts stock via the ledger. **Changed:** routes through `adjust_stock` and saves the transcript.

**Body:**
```json
{
  "transcript": "तीन नीली सूती साड़ी बिक गईं",
  "language_code": "hi-IN"
}
```

#### `GET /v1/inventory/:productId/movements` *(new)*

Returns paginated stock movements for one product.

**Query params:** `limit` (default 20), `offset` (default 0)

**Response:**
```json
{
  "movements": [
    {
      "id": "uuid",
      "product_id": "uuid",
      "artisan_id": "uuid",
      "delta": -3,
      "resulting_quantity": 7,
      "reason": "voice",
      "voice_transcript": "तीन साड़ी बिक गईं",
      "created_at": "2026-11-13T15:30:00Z"
    }
  ],
  "total": 42
}
```

---

### Analytics

#### `GET /v1/analytics/summary` *(new)*

Returns inventory health metrics for the signed-in artisan.

**Response:**
```json
{
  "summary": {
    "total_products": 12,
    "total_stock_units": 147,
    "total_inventory_value_retail": 293460.00,
    "total_inventory_value_wholesale": 192100.00,
    "low_stock_count": 3,
    "out_of_stock_count": 1
  }
}
```

#### `GET /v1/analytics/stock-trend?days=N` *(new)*

Returns daily stock movement trend for the last N days (max 90).

**Response:**
```json
{
  "trend": [
    {
      "movement_date": "2026-11-12",
      "reason": "voice",
      "movement_count": 5,
      "total_delta": -8,
      "units_added": 0,
      "units_sold_or_removed": 8
    }
  ]
}
```

---

### Inquiries

#### `POST /v1/marketplace/inquiries` *(new)*

Creates a buyer inquiry. The sender (`buyer_artisan_id`) is taken from the JWT token, never from the request body. Guards:
- Cannot enquire about your own product (self-inquiry)
- Duplicate guard: cannot send the same message to the same product twice

**Body:**
```json
{
  "product_id": "uuid",
  "product_name": "Blue Cotton Saree",
  "message": "I want to buy 5 pieces for my shop",
  "requested_quantity": 5,
  "offered_price_inr": 6500
}
```

#### `PATCH /v1/marketplace/inquiries/:id` *(new)*

Updates the status of an inquiry the artisan received.

**Body:**
```json
{ "status": "replied" }
```

Valid statuses: `new`, `replied`, `won`, `lost`.

#### `GET /v1/marketplace/inquiries`

Returns inquiries for the signed-in artisan. **Changed:** now supports status filtering, pagination, and a fix for `speak=false` boolean coercion.

**Query params:** `language_code`, `speak`, `status`, `limit`, `offset`

---

## Services

| Service | File | Purpose |
|---------|------|---------|
| `stockLedger.service.ts` | `services/stockLedger.service.ts` | `adjustStock()` via RPC with manual fallback; `getStockMovements()` with pagination |
| `analytics.service.ts` | `services/analytics.service.ts` | `getInventorySummary()` and `getStockTrend()` with view-first + JS fallback |
| `pgErrors.ts` | `services/pgErrors.ts` | `StockLedgerError`, `InsufficientStockError`, `ProductNotFoundError`, `classifyPgError()` |

---

## Tests

| Test file | Count | What it covers |
|-----------|-------|----------------|
| `stock-ledger.test.ts` | 7 | adjustStock RPC/fallback, insufficient stock, product not found |
| `analytics.test.ts` | 4 | Summary view-first + fallback, trend view-first + fallback |
| `analytics-routes.test.ts` | 4 | GET /summary, GET /stock-trend, auth checks |
| `identity-isolation.test.ts` | 8 | Every endpoint rejects cross-artisan access |
| `voice-stock.test.ts` | 8 | Voice parser: digits, Devanagari numerals, Devanagari digits, word-boundary, SKU matching |
| `migrations-nikhil.test.ts` | 19 | Idempotency lint for 030–032: no destructive statements, IF NOT EXISTS, OR REPLACE |

**Smoke test:** `src/db/migrations/verify/030_031_032_smoke.sql` — paste into Supabase SQL Editor after applying migrations 030–032. Runs 20 checks inside a `ROLLBACK` transaction.

---

## Mobile (Frontend)

| File | Purpose |
|------|---------|
| `services/apiClient.ts` | Added: `stockMovements()`, `inventorySummary()`, `stockTrend()`, `createInquiry()`, `updateInquiryStatus()` + types |
| `components/ui/StockHistorySheet.tsx` | Bottom-sheet modal with paginated stock movements; opens on long-press of a product card |
| `components/ui/TrendBars.tsx` | Paired bar chart (added vs sold) for daily stock movement trends |
| `components/ui/InquiryStatusPill.tsx` | Coloured status pill: new (yellow), replied (lime), won (green), lost (grey) |
| `app/analytics.tsx` | Insights screen: inventory value, units, low-stock alerts, inquiry count, TrendBars |
| `app/(tabs)/index.tsx` | Added "Business Insights" card linking to analytics screen |
| `app/(tabs)/inventory.tsx` | Added StockHistorySheet integration + history icon chip on each product card |
| `app/listing/[id].tsx` | Added send-enquiry form for other artisans' products (message, qty, price) |

---

## Graceful Degradation

Every feature works **before** its migration is applied:

| Migration | Before applied | After applied |
|-----------|---------------|---------------|
| 030 | `adjustStock()` falls back to manual read-then-update | Uses `adjust_stock()` RPC |
| 031 | `getInventorySummary()` aggregates from `products` table in JS | Reads `v_artisan_inventory_summary` view |
| 031 | `getStockTrend()` aggregates from `stock_movements` in JS | Reads `v_daily_stock_movements` view |
| 032 | Inquiry status/sender columns may be absent; routes handle nulls | Full inquiry workflow |
