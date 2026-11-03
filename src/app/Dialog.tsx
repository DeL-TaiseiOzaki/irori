import { useEffect, useRef, type ReactNode } from 'react';

export function Dialog({
  children,
  label,
  busy = false,
  onClose,
  className = 'modal-dialog',
  closeOnBackdrop = false,
}: {
  children: ReactNode;
  label: string;
  busy?: boolean;
  onClose: () => void;
  className?: string;
  /**
   * A press that starts and ends on the backdrop closes it too, for a sheet that only
   * changes settings. The sheet must fill the dialog, so only the backdrop is the dialog.
   */
  closeOnBackdrop?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onPointerDown={(event) => {
        pressedBackdrop.current = closeOnBackdrop && event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === event.currentTarget && !busy) onClose();
        pressedBackdrop.current = false;
      }}
    >
      {children}
    </dialog>
  );
}
