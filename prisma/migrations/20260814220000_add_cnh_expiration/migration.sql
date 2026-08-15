-- Migration: Add cnhExpiration to driver_profiles
--
-- Context: The driver import spreadsheet carries a CNH expiration date, but
-- it was never persisted. The distribution algorithm must flag drivers with
-- an expired CNH (shown as `*` in the UI) without blocking their allocation.
--
-- This migration adds a nullable column. NULL means "unknown / not set" and
-- is treated as NOT expired by the algorithm.

ALTER TABLE "driver_profiles" ADD COLUMN "cnhExpiration" TIMESTAMP(3);
