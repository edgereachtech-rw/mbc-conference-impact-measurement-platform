-- Webinars are events too (decision 2026-11-19). A new enum value travels in its own migration.
ALTER TYPE "event_type" ADD VALUE 'webinar';
