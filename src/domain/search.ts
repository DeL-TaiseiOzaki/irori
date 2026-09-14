import { z } from 'zod';

export const searchQuery = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\r\n\0]+$/);

export interface SearchHit {
  path: string;
  line: number;
  preview: string;
}

export interface KnowledgeSearch {
  scopeId: string;
  query: string;
  hits: SearchHit[];
  scannedFiles: number;
  skippedFiles: number;
  incomplete: boolean;
}
