/** What the catalog stores about one segment. Measurements are optional: the relay may omit them. */
export interface CatalogEntry {
  key: string;
  cam: string;
  start: Date;
  size: number;
  uploaded: Date;
  sha256: string;
  metadata: Record<string, string>;
}
