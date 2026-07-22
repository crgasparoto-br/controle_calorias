-- No-op: professionalOperationalRequests, professionalReviewSignals and
-- professionalOperationalAlerts (tables, indexes and FKs) already existed
-- in the database before this migration was tracked (drift from an
-- earlier out-of-band run). Nothing left to apply.
SELECT 1;
