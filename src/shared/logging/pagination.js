/**
 * Shared Pagination Utilities for Log Modules.
 */

/**
 * Calculate pagination offsets, total pages, and boundaries.
 *
 * @param {Object} options
 * @param {number} options.totalItems
 * @param {number} [options.currentPage=1] 1-indexed
 * @param {number} [options.pageSize=5]
 * @returns {{ totalPages: number, currentPage: number, offset: number, limit: number, hasNext: boolean, hasPrev: boolean }}
 */
export function calculatePagination({
  totalItems = 0,
  currentPage = 1,
  pageSize = 5,
} = {}) {
  const validPageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(totalItems / validPageSize));
  const page = Math.max(1, Math.min(currentPage, totalPages));
  const offset = (page - 1) * validPageSize;

  return {
    totalPages,
    currentPage: page,
    pageSize: validPageSize,
    offset,
    limit: validPageSize,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * Slice an in-memory array of items based on pagination parameters.
 *
 * @param {Array<any>} items
 * @param {number} [currentPage=1]
 * @param {number} [pageSize=5]
 * @returns {{ items: Array<any>, pagination: Object }}
 */
export function paginateArray(items = [], currentPage = 1, pageSize = 5) {
  const pagination = calculatePagination({
    totalItems: items.length,
    currentPage,
    pageSize,
  });

  const sliced = items.slice(
    pagination.offset,
    pagination.offset + pagination.limit
  );

  return {
    items: sliced,
    pagination,
  };
}
