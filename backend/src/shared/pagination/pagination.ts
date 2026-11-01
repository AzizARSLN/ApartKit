import { z } from "zod";

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export function paginationOffset(query: PaginationQuery): { limit: number; offset: number } {
  return {
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  };
}

export function paginatedResult<T>(items: T[], total: number, query: PaginationQuery) {
  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}
