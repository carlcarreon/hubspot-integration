type RetryButtonProps = {
  canRetry: boolean;
  orderId: string;
  retryingOrderId: string | null;
  onRetry: (orderId: string) => void;
};

export function RetryButton({ canRetry, orderId, retryingOrderId, onRetry }: RetryButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!canRetry || retryingOrderId === orderId}
      onClick={() => onRetry(orderId)}
      className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:border-slate-200 disabled:text-slate-400"
    >
      {retryingOrderId === orderId ? 'Queueing…' : 'Retry'}
    </Button>
  );
}
import { Button } from '../ui/button';
