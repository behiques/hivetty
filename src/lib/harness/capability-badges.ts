import { CAPABILITIES, type HarnessId } from '@shared/harness-contract';

/** What a session on this CLI supports, in the session menu's order (HIVE-281). */
export function capabilityBadges(cli: HarnessId): { label: string; supported: boolean }[] {
  const c = CAPABILITIES[cli];
  return [
    { label: 'Hooks', supported: c.hooks },
    { label: 'Permission cards', supported: c.permissionCards },
    { label: 'Plan', supported: c.plan },
    { label: 'Skills', supported: c.skills },
    { label: 'Prompt markers', supported: c.contextDelivery === 'prompt-marker' },
  ];
}
