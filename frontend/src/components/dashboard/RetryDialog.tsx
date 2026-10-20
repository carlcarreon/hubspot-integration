type RetryDialogProps = {
  orderId: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function RetryDialog({ orderId, busy, onCancel, onConfirm }: RetryDialogProps) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="max-w-md border border-slate-200 bg-white p-6 shadow-2xl">
        <AlertDialogHeader className="place-items-start text-left">
          <AlertDialogTitle className="text-lg font-bold text-slate-950">Retry {orderId}?</AlertDialogTitle>
          <AlertDialogDescription className="text-left leading-6 text-slate-600">
            This queues the failed order for the existing durable worker. Its prior attempts and known HubSpot IDs are
            preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-2 -mx-6 -mb-6 border-slate-200 bg-slate-50">
          <AlertDialogCancel disabled={busy} className="border-slate-300 text-slate-700">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={busy}
            className="bg-indigo-600 text-white hover:bg-indigo-700"
          >
            {busy ? 'Queueing…' : 'Retry order'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
