import { useEffect, useRef, type ReactNode } from 'react';
import { registerBackHandler } from '../utils/back-nav';

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(
    () =>
      registerBackHandler(() => {
        onClose();
        return true;
      }),
    [onClose],
  );
  return (
    <dialog
      ref={dialog}
      className="pos-sheet"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="p-4">
        <header className="sticky top-0 z-10 -mx-4 -mt-4 mb-3 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <h2 className="vf-title">{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
