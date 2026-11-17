import { Migration } from '@medusajs/framework/mikro-orm/migrations'

export class Migration20261117193028 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "ml_order" drop constraint if exists "ml_order_external_key_unique";`
    )
    this.addSql(
      `alter table if exists "ml_listing" drop constraint if exists "ml_listing_item_id_unique";`
    )
    this.addSql(
      `alter table if exists "ml_event" drop constraint if exists "ml_event_notification_id_unique";`
    )
    this.addSql(
      `alter table if exists "ml_account" drop constraint if exists "ml_account_seller_id_unique";`
    )
    this.addSql(
      `create table if not exists "ml_account" ("id" text not null, "seller_id" text not null, "nickname" text null, "site_id" text not null, "access_token" text not null, "refresh_token" text not null, "expires_at" timestamptz not null, "user_products" boolean not null default false, "connected_by" text null, "problem" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ml_account_pkey" primary key ("id"));`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ml_account_deleted_at" ON "ml_account" ("deleted_at") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ml_account_seller_id_unique" ON "ml_account" ("seller_id") WHERE deleted_at IS NULL;`
    )

    this.addSql(
      `create table if not exists "ml_event" ("id" text not null, "notification_id" text not null, "topic" text not null, "resource" text not null, "seller_id" text null, "processed_at" timestamptz null, "tries" integer not null default 0, "problem" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ml_event_pkey" primary key ("id"));`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ml_event_deleted_at" ON "ml_event" ("deleted_at") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ml_event_notification_id_unique" ON "ml_event" ("notification_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ml_event_processed_at" ON "ml_event" ("processed_at") WHERE deleted_at IS NULL;`
    )

    this.addSql(
      `create table if not exists "ml_listing" ("id" text not null, "product_id" text not null, "variants" jsonb not null, "item_id" text null, "permalink" text null, "status" text check ("status" in ('draft', 'active', 'paused', 'closed', 'under_review', 'inactive', 'error')) not null default 'draft', "external_status" text null, "category_id" text not null, "category_name" text null, "listing_type_id" text not null default 'gold_special', "price_adjustment_percent" real null, "settings" jsonb null, "sync_stock" boolean not null default true, "sync_price" boolean not null default true, "pushed" jsonb null, "problem" text null, "synced_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ml_listing_pkey" primary key ("id"));`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ml_listing_deleted_at" ON "ml_listing" ("deleted_at") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ml_listing_product_id" ON "ml_listing" ("product_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ml_listing_item_id_unique" ON "ml_listing" ("item_id") WHERE item_id IS NOT NULL AND deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ml_listing_status" ON "ml_listing" ("status") WHERE deleted_at IS NULL;`
    )

    this.addSql(
      `create table if not exists "ml_order" ("id" text not null, "external_key" text not null, "pack_id" text null, "order_ids" jsonb not null, "shipment_id" text null, "order_id" text null, "status" text not null, "shipping_status" text null, "shipping_substatus" text null, "shipping_mode" text null, "logistic_type" text null, "tracking_number" text null, "buyer_nickname" text null, "total" real null, "currency_code" text null, "problem" text null, "sold_at" timestamptz null, "synced_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ml_order_pkey" primary key ("id"));`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ml_order_deleted_at" ON "ml_order" ("deleted_at") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ml_order_external_key_unique" ON "ml_order" ("external_key") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ml_order_order_id" ON "ml_order" ("order_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ml_order_shipment_id" ON "ml_order" ("shipment_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ml_order_status" ON "ml_order" ("status") WHERE deleted_at IS NULL;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ml_account" cascade;`)

    this.addSql(`drop table if exists "ml_event" cascade;`)

    this.addSql(`drop table if exists "ml_listing" cascade;`)

    this.addSql(`drop table if exists "ml_order" cascade;`)
  }
}
