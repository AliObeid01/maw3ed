import {
  BarChart3,
  CalendarDays,
  CircleCheck,
  CircleUser,
  Clock,
  Hourglass,
  Link2,
  ListChecks,
  MessageCircle,
  SlidersHorizontal,
  Tag,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type NavId =
  | 'today'
  | 'reminders'
  | 'outcomes'
  | 'clients'
  | 'waitlist'
  | 'pilot'
  | 'setup'
  | 'services'
  | 'staff'
  | 'hours'
  | 'settings'
  | 'share'
  | 'account';

/** Pages the shell knows about; `book` has no nav item but is a valid active page (New booking). */
export type ActiveId = NavId | 'book';

export const mainNav: NavId[] = ['today', 'reminders', 'outcomes', 'clients', 'waitlist', 'pilot'];
export const businessNav: NavId[] = ['setup', 'services', 'staff', 'hours', 'settings', 'share'];
/** Bottom tab bar (the fifth tab is More). */
export type TabId = 'today' | 'reminders' | 'outcomes' | 'clients' | 'account';
export const tabNav: TabId[] = ['today', 'reminders', 'outcomes', 'clients'];
/** The barber (PRACTITIONER) shell: three destinations, no More sheet, no business navigation, no New booking. */
export const practitionerNav: TabId[] = ['today', 'outcomes', 'account'];
/** The barber sidebar's main list (Account sits in its footer, as for everyone). */
export const practitionerMainNav: NavId[] = ['today', 'outcomes'];
/** Everything that lives in the More sheet. */
export const moreNav: NavId[] = ['waitlist', 'pilot', 'account', ...businessNav];

export const navIcons: Record<NavId, LucideIcon> = {
  today: CalendarDays,
  reminders: MessageCircle,
  outcomes: CircleCheck,
  clients: Users,
  waitlist: Hourglass,
  pilot: BarChart3,
  setup: ListChecks,
  services: Tag,
  staff: User,
  hours: Clock,
  settings: SlidersHorizontal,
  share: Link2,
  account: CircleUser,
};

export const defaultHrefs: Record<ActiveId, string> = {
  today: '/app',
  reminders: '/app/reminders',
  outcomes: '/app/outcomes',
  clients: '/app/clients',
  waitlist: '/app/waitlist',
  pilot: '/app/pilot',
  setup: '/app/setup',
  services: '/app/services',
  staff: '/app/staff',
  hours: '/app/hours',
  settings: '/app/settings',
  share: '/app/share',
  account: '/app/account',
  book: '/app/book',
};

export type NavBadges = { reminders?: number; outcomes?: number };

export const badgeTone = { reminders: 'danger', outcomes: 'warning' } as const;
