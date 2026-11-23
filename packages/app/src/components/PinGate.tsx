import { useState, type ReactNode } from 'react';
import { PinPrompt } from './PinPrompt';

interface PinGateProps {
  /** True when a PIN is configured in Settings. */
  enabled: boolean;
  /** Section name shown in the prompt, for example "Reports". */
  section: string;
  onCancel: () => void;
  children: ReactNode;
}

/**
 * Requires the PIN before a protected section mounts. The gate is evaluated
 * once per visit: enabling a PIN from inside Settings must not re-prompt while
 * the owner is still on that screen.
 */
export function PinGate({ enabled, section, onCancel, children }: PinGateProps) {
  const [allowed, setAllowed] = useState(!enabled);

  if (!enabled || allowed) return <>{children}</>;

  return (
    <PinPrompt
      title={`PIN required for ${section}`}
      description={`Enter your PIN to open ${section}.`}
      onSuccess={() => setAllowed(true)}
      onCancel={onCancel}
    />
  );
}
