import {
  BarChart3,
  CalendarDays,
  CircleCheck,
  Clock,
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
  | 'pilot'
  | 'setup'
  | 'services'
  | 'staff'
  | 'hours'
  | 'settings'
  | 'share';

/** Pages the shell knows about; `book` has no nav item but is a valid active page (New booking). */
export type ActiveId = NavId | 'book';

export const mainNav: NavId[] = ['today', 'reminders', 'outcomes', 'clients', 'pilot'];
export const businessNav: NavId[] = ['setup', 'services', 'staff', 'hours', 'settings', 'share'];
/** Bottom tab bar (the fifth tab is More). */
export type TabId = 'today' | 'reminders' | 'outcomes' | 'clients';
export const tabNav: TabId[] = ['today', 'reminders', 'outcomes', 'clients'];
/** Everything that lives in the More sheet. */
export const moreNav: NavId[] = ['pilot', ...businessNav];

export const navIcons: Record<NavId, LucideIcon> = {
  today: CalendarDays,
  reminders: MessageCircle,
  outcomes: CircleCheck,
  clients: Users,
  pilot: BarChart3,
  setup: ListChecks,
  services: Tag,
  staff: User,
  hours: Clock,
  settings: SlidersHorizontal,
  share: Link2,
};

export const defaultHrefs: Record<ActiveId, string> = {
  today: '/app',
  reminders: '/app/reminders',
  outcomes: '/app/outcomes',
  clients: '/app/clients',
  pilot: '/app/pilot',
  setup: '/app/setup',
  services: '/app/services',
  staff: '/app/staff',
  hours: '/app/hours',
  settings: '/app/settings',
  share: '/app/share',
  book: '/app/book',
};

export type NavBadges = { reminders?: number; outcomes?: number };

export const badgeTone = { reminders: 'danger', outcomes: 'warning' } as const;
