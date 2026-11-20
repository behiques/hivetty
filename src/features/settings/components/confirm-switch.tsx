import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Switch } from '@/components/ui/switch';

import { InlineConfirm } from '@features/shared/components/inline-confirm';

interface ConfirmSwitchProps {
  label: string;
  description: ReactNode;
  checked: boolean;
  /** What the person reads before the switch goes on. */
  confirm: { label: string; title: string; confirmLabel: string; body: string };
  onChange: (checked: boolean) => void;
}

/**
 * A switch that asks before it goes on, inline as every confirm in Settings does
 * (`config-reset-confirm.tsx`). Off is the safe way and writes at once.
 */
export function ConfirmSwitch({ label, description, checked, confirm, onChange }: ConfirmSwitchProps) {
  const [confirming, setConfirming] = useState(false);
  const control = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // The confirm replaced the switch, so its buttons took focus with them; hand it back once the switch is mounted again.
  useEffect(() => {
    if (confirming || !returnFocus.current) return;
    returnFocus.current = false;
    control.current?.focus();
  }, [confirming]);

  const close = () => {
    returnFocus.current = true;
    setConfirming(false);
  };

  if (confirming) {
    return (
      <InlineConfirm
        label={confirm.label}
        title={confirm.title}
        confirmLabel={confirm.confirmLabel}
        className="rounded-lg border border-red"
        onCancel={close}
        onConfirm={() => {
          close();
          onChange(true);
        }}
      >
        {confirm.body}
      </InlineConfirm>
    );
  }

  return (
    <Switch
      ref={control}
      label={label}
      description={description}
      checked={checked}
      onCheckedChange={(next) => (next ? setConfirming(true) : onChange(false))}
    />
  );
}
