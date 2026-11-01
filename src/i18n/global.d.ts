import type en from '../../messages/en.json';
import type { Locale } from './config';

// Typed message keys: `t('typo')` or a removed key fails `pnpm typecheck`. English is the source of truth;
// `scripts/i18n/check-keys.mjs` keeps ar.json identical in shape.
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof en;
  }
}
