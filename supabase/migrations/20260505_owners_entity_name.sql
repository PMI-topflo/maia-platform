-- Add entity_name column to owners table for LLC/Corp/Trust ownership records
ALTER TABLE public.owners
  ADD COLUMN IF NOT EXISTS entity_name text;
