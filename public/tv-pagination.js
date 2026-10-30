// Preserva a ordem do catálogo e distribui as sobras entre as primeiras páginas.
export const TV_MAX_ROWS = 16;
export const TV_PAGE_CAPACITY = TV_MAX_ROWS * 2;
export function balancedPageRanges(total, capacity = TV_PAGE_CAPACITY) {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Paginação inválida.');
  const pages = Math.max(1, Math.ceil(total / capacity));
  const base = Math.floor(total / pages), remainder = total % pages;
  let start = 0;
  return Array.from({ length: pages }, (_, index) => {
    const end = start + base + (index < remainder ? 1 : 0);
    const range = { start, end }; start = end; return range;
  });
}
export function productPageIndex(total, position, capacity = TV_PAGE_CAPACITY) {
  const ranges = balancedPageRanges(total, capacity);
  const index = Math.min(Math.max(0, position), Math.max(0, total - 1));
  return Math.max(0, ranges.findIndex(range => index < range.end));
}
export function pageProducts(products, page, capacity = TV_PAGE_CAPACITY) {
  const ranges = balancedPageRanges(products.length, capacity);
  const range = ranges[Math.min(Math.max(0, page), ranges.length - 1)];
  return products.slice(range.start, range.end);
}
