import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../messages/en.json';

/** Server-render a component inside the English message provider. */
export function render(element: ReactElement): string {
  return renderToStaticMarkup(
    // eslint-disable-next-line react/no-children-prop -- createElement's typings need children in props here
    createElement(NextIntlClientProvider, { locale: 'en', messages: en, children: element }),
  );
}
