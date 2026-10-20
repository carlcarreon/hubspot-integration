export function EmptyState({ message }: { message: string }) {
  return <div className="px-5 py-16 text-center text-slate-500">{message}</div>;
}

export function LoadingRows({ label }: { label: string }) {
  return (
    <div className="space-y-3 p-5" aria-label={label}>
      {[1, 2, 3, 4].map((row) => (
        <Skeleton key={row} className="h-14 rounded-lg bg-slate-100" />
      ))}
    </div>
  );
}
import { Skeleton } from '../ui/skeleton';
