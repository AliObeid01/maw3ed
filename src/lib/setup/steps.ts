import type { SetupFlags } from '@/lib/api/setup';

export const SETUP_STEP_IDS = ['business', 'services', 'staff', 'hours', 'share', 'invite'] as const;
export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

export type SetupStep = { id: SetupStepId; done: boolean; current: boolean };

export type SetupSignals = {
  flags: SetupFlags;
  /** The owner opened or copied the booking link (remembered in this browser). */
  shareSeen: boolean;
  /** At least one receptionist has joined or has a pending invite. */
  hasReceptionist: boolean;
};

/**
 * The six owner steps in board order. "Business details" is always done (signup collects name, link and
 * timezone). The first unfinished step is the current one (highlighted with a "next step" hint).
 */
export function deriveSetupSteps({ flags, shareSeen, hasReceptionist }: SetupSignals): {
  steps: SetupStep[];
  doneCount: number;
  percent: number;
} {
  const done: Record<SetupStepId, boolean> = {
    business: true,
    services: flags.hasServices,
    staff: flags.hasBookableStaff,
    hours: flags.hasHours,
    share: shareSeen,
    invite: hasReceptionist,
  };
  const firstOpen = SETUP_STEP_IDS.find((id) => !done[id]);
  const steps = SETUP_STEP_IDS.map((id) => ({ id, done: done[id], current: id === firstOpen }));
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, percent: Math.round((doneCount / steps.length) * 100) };
}

export const stepHrefs: Record<SetupStepId, string> = {
  business: '/app/settings',
  services: '/app/services',
  staff: '/app/staff',
  hours: '/app/hours',
  share: '/app/share',
  invite: '/app/staff',
};

export const SHARE_SEEN_KEY = 'maw3ed.shareSeen';
