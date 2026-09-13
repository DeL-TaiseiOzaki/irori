import { useEffect, useRef, type ReactNode } from 'react';

export function Dialog({
  children,
  label,
  busy = false,
  onClose,
  className = 'modal-dialog',
}: {
  children: ReactNode;
  label: string;
  busy?: boolean;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
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
    >
      {children}
    </dialog>
  );
}
