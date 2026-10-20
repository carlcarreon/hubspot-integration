import type { Pagination } from '../../services/dashboard-api';
import { pageRange, type PageItem } from '../pagination';
import { Button } from '../ui/button';

type PaginationControlsProps = {
  pagination: Pagination;
  onSelectPage: (page: number) => void;
};

export function PaginationControls({ pagination, onSelectPage }: PaginationControlsProps) {
  const first = pagination.totalItems === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const last = Math.min(pagination.page * pagination.limit, pagination.totalItems);
  const cannotGoPrevious = pagination.page === 1 || pagination.totalPages === 0;
  const cannotGoNext = pagination.page === pagination.totalPages || pagination.totalPages === 0;

  return (
    <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
      <span>
        Showing {first}–{last} of {pagination.totalItems} records
      </span>
      <nav className="flex items-center gap-1" aria-label="Pagination">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSelectPage(pagination.page - 1)}
          disabled={cannotGoPrevious}
          aria-label="Previous page"
          title="Previous page"
          className="border-slate-300"
        >
          &lt;
        </Button>
        <PageNumbers
          items={pageRange(pagination.totalPages, pagination.page)}
          currentPage={pagination.page}
          onSelectPage={onSelectPage}
          className="hidden sm:flex"
        />
        <PageNumbers
          items={pageRange(pagination.totalPages, pagination.page, 1, 0)}
          currentPage={pagination.page}
          onSelectPage={onSelectPage}
          className="flex sm:hidden"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSelectPage(pagination.page + 1)}
          disabled={cannotGoNext}
          aria-label="Next page"
          title="Next page"
          className="border-slate-300"
        >
          &gt;
        </Button>
      </nav>
    </div>
  );
}

type PageNumbersProps = {
  items: PageItem[];
  currentPage: number;
  onSelectPage: (page: number) => void;
  className: string;
};

function PageNumbers({ items, currentPage, onSelectPage, className }: PageNumbersProps) {
  return (
    <div className={`items-center gap-1 ${className}`}>
      {items.map((item, index) =>
        item === 'ellipsis' ? (
          <span key={`ellipsis-${index}`} className="px-1">
            …
          </span>
        ) : (
          <Button
            key={item}
            variant={item === currentPage ? 'default' : 'outline'}
            size="sm"
            onClick={() => onSelectPage(item)}
            aria-current={item === currentPage ? 'page' : undefined}
            className={
              item === currentPage
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'border-slate-300 hover:bg-slate-50'
            }
          >
            {item}
          </Button>
        ),
      )}
    </div>
  );
}
