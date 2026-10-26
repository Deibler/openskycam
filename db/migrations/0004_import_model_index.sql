-- This migration once indexed one deployment's private model files, which other deployments do not
-- have. A new catalog starts with no models; publish your own (docs/models.md). The file
-- stays so migration names keep their order; catalogs that already applied it are unaffected.
SELECT 1;
