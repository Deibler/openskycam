/** Logical membership in the shared media lake. A bucket does not own a copy of the media. */
export interface WorkshopBucket {
  id: string;
  name: string;
  kind: 'raw' | 'labeled';
  description: string;
  createdAt: string | null;
}
export interface BucketUsage {
  writes: string[];
  reads: string[];
}
