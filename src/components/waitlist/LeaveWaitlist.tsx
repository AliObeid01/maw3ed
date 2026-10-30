'use client';

import { BellOff, Check, LinkIcon, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PageState } from '@/components/public/PageState';
import { Button, ButtonLink } from '@/components/ui/Button';
import { leaveWaitlist } from '@/lib/api/waitlist';
import { classifyOfferError } from '@/lib/waitlist/offer';

type State =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; removed: boolean }
  | { kind: 'invalid' }
  | { kind: 'error'; network: boolean };

/** /o/[token]/leave. Opening the page changes nothing; the removal is a POST on the button. */
export function LeaveWaitlist({ token }: { token: string }) {
  const t = useTranslations('offer');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function leave() {
    setState({ kind: 'working' });
    try {
      const res = await leaveWaitlist(token);
      setState({ kind: 'done', removed: res.removed });
    } catch (error) {
      const failure = classifyOfferError(error);
      setState(
        failure === 'invalid' || failure === 'expired'
          ? { kind: 'invalid' }
          : { kind: 'error', network: failure === 'network' },
      );
    }
  }

  if (state.kind === 'invalid')
    return (
      <PageState
        role="status"
        icon={<LinkIcon size={26} />}
        title={t('invalid.title')}
        body={t('invalid.body')}
        action={
          <ButtonLink href="/" size="lg" block>
            {t('invalid.action')}
          </ButtonLink>
        }
      />
    );
  if (state.kind === 'done')
    return (
      <PageState
        role="status"
        icon={<Check size={26} />}
        title={t(state.removed ? 'leave.doneTitle' : 'leave.keptTitle')}
        body={t(state.removed ? 'leave.doneBody' : 'leave.keptBody')}
        action={
          <ButtonLink href="/" size="lg" block>
            {t('leave.action')}
          </ButtonLink>
        }
      />
    );
  return (
    <PageState
      role={state.kind === 'error' ? 'alert' : undefined}
      tone={state.kind === 'error' ? 'warning' : 'brand'}
      icon={state.kind === 'error' ? <TriangleAlert size={26} /> : <BellOff size={26} />}
      title={t('leave.title')}
      body={
        state.kind === 'error'
          ? t(state.network ? 'errors.network' : 'errors.generic')
          : t('leave.body')
      }
      action={
        <Button size="lg" block onClick={leave} loading={state.kind === 'working'}>
          {state.kind === 'working' ? t('leave.working') : t('leave.confirm')}
        </Button>
      }
    />
  );
}
