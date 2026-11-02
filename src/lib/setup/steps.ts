import type { SetupFlags } from '@/lib/api/setup';

export const SETUP_STEP_IDS = [
  'business',
  'services',
  'staff',
  'hours',
  'share',
  'invite',
  'publish',
] as const;
export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

export type SetupStep = { id: SetupStepId; done: boolean; current: boolean; optional: boolean };

/** Optional steps are shown but never block 100% and never count in the totals. */
const OPTIONAL: readonly SetupStepId[] = ['publish'];

export type SetupSignals = {
  flags: SetupFlags;
  /** The owner opened or copied the booking link (remembered in this browser). */
  shareSeen: boolean;
  /** At least one receptionist has joined or has a pending invite. */
  hasReceptionist: boolean;
  /** The business opted in to the public directory. */
  listed?: boolean;
};

/**
 * The seven owner steps: the six required ones in board order, then the optional directory step last. "Business details" is always done (signup collects name, link and
 * timezone). The first unfinished step is the current one (highlighted with a "next step" hint).
 */
export function deriveSetupSteps({ flags, shareSeen, hasReceptionist, listed = false }: SetupSignals): {
  steps: SetupStep[];
  doneCount: number;
  /** Required steps only. */
  total: number;
  percent: number;
} {
  const done: Record<SetupStepId, boolean> = {
    business: true,
    services: flags.hasServices,
    staff: flags.hasBookableStaff,
    hours: flags.hasHours,
    publish: listed,
    share: shareSeen,
    invite: hasReceptionist,
  };
  const firstOpen = SETUP_STEP_IDS.find((id) => !done[id] && !OPTIONAL.includes(id));
  const steps = SETUP_STEP_IDS.map((id) => ({
    id,
    done: done[id],
    current: id === firstOpen,
    optional: OPTIONAL.includes(id),
  }));
  const required = steps.filter((s) => !s.optional);
  const doneCount = required.filter((s) => s.done).length;
  return {
    steps,
    doneCount,
    total: required.length,
    percent: Math.round((doneCount / required.length) * 100),
  };
}

export const stepHrefs: Record<SetupStepId, string> = {
  business: '/app/settings',
  services: '/app/services',
  staff: '/app/staff',
  hours: '/app/hours',
  publish: '/app/share#directory',
  share: '/app/share',
  invite: '/app/staff',
};

/** Per business, so a second owner on the same browser does not inherit the tick. */
export const shareSeenKey = (slug: string) => `maw3ed.shareSeen.${slug}`;
