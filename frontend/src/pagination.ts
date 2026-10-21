export type PageItem = number | 'ellipsis';

export function pageRange(totalPages: number, currentPage: number, edgeCount = 3, neighborCount = 1): PageItem[] {
  if (totalPages <= 0) return [];
  if (totalPages <= edgeCount * 2 + neighborCount * 2 + 1) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const pages = new Set<number>();
  for (let page = 1; page <= Math.min(edgeCount, totalPages); page += 1) pages.add(page);
  for (let page = Math.max(1, currentPage - neighborCount); page <= Math.min(totalPages, currentPage + neighborCount); page += 1) pages.add(page);
  for (let page = Math.max(1, totalPages - edgeCount + 1); page <= totalPages; page += 1) pages.add(page);

  const result: PageItem[] = [];
  for (const page of [...pages].sort((left, right) => left - right)) {
    const previous = result.at(-1);
    if (typeof previous === 'number' && page - previous > 1) result.push('ellipsis');
    result.push(page);
  }
  return result;
}
