import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import type { DashboardView, PageLimit, StatusFilter } from './types';

export const statusOptions: Array<{ label: string; value: StatusFilter }> = [
  { label: 'All current statuses', value: '' },
  { label: 'Successful', value: 'SUCCESS' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Processing', value: 'PROCESSING' },
];

const allStatusesValue = 'ALL_STATUSES';

type DashboardControlsProps = {
  view: DashboardView;
  status: StatusFilter;
  query: string;
  limit: PageLimit;
  onViewChange: (view: DashboardView) => void;
  onStatusChange: (status: StatusFilter) => void;
  onQueryChange: (query: string) => void;
  onClearQuery: () => void;
  onLimitChange: (limit: PageLimit) => void;
};

export function DashboardControls({
  view,
  status,
  query,
  limit,
  onViewChange,
  onStatusChange,
  onQueryChange,
  onClearQuery,
  onLimitChange,
}: DashboardControlsProps) {
  return (
    <>
      <div className="flex flex-col gap-4 border-b border-slate-200 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 id="monitoring-table-title" className="font-bold text-slate-900">
            Orders &amp; Sync Status
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Current orders include legacy failures without attempt rows. The Attempts view is the newest 50 real audit
            records.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="text-sm font-medium text-slate-700">
            <span className="mr-2">Current status</span>
            <Select
              value={status || allStatusesValue}
              onValueChange={(value) => onStatusChange(value === allStatusesValue ? '' : (value as StatusFilter))}
            >
              <SelectTrigger
                id="status-filter"
                aria-label="Current status"
                className="min-w-48 bg-white text-slate-800"
              >
                <SelectValue>{statusOptions.find((option) => option.value === status)?.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value || 'all'} value={option.value || allStatusesValue}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm font-medium text-slate-700">
            <span className="mr-2">Rows</span>
            <Select value={String(limit)} onValueChange={(value) => onLimitChange(Number(value) as PageLimit)}>
              <SelectTrigger id="page-limit" aria-label="Rows" className="min-w-20 bg-white text-slate-800">
                <SelectValue>{String(limit)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <div className="border-b border-slate-200 px-5 py-3">
        <label className="block text-sm font-medium text-slate-700" htmlFor="orders-search">
          Search orders, email, or HubSpot ID
        </label>
        <div className="mt-1 flex max-w-xl gap-2">
          <Input
            id="orders-search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Order ID, customer email, Contact ID, or Deal ID"
            className="h-10 bg-white px-3 text-slate-900"
          />
          {query && (
            <Button
              variant="outline"
              onClick={onClearQuery}
              className="h-10 border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              Clear
            </Button>
          )}
        </div>
      </div>
      <Tabs value={view} onValueChange={(value) => onViewChange(value as DashboardView)} className="gap-0">
        <TabsList
          variant="line"
          className="h-auto w-full justify-start rounded-none border-b border-slate-200 px-5 py-0"
          aria-label="Monitoring data view"
        >
          <TabsTrigger value="orders" className="h-auto flex-none px-4 py-3 text-slate-500 data-active:text-indigo-700">
            Orders
          </TabsTrigger>
          <TabsTrigger
            value="attempts"
            className="h-auto flex-none px-4 py-3 text-slate-500 data-active:text-indigo-700"
          >
            Attempts (Latest 50)
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </>
  );
}
