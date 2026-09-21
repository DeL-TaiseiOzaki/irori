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
  /** A link's visible text as written and where it starts on the line; text search has neither. */
  label?: string;
  column?: number;
}

export interface KnowledgeSearch {
  scopeId: string;
  query: string;
  hits: SearchHit[];
  scannedFiles: number;
  skippedFiles: number;
  incomplete: boolean;
}
