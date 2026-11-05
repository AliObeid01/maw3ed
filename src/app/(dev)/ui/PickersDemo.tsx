'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DatePicker } from '@/components/ui/DatePicker';
import { Select } from '@/components/ui/Select';
import { TimePicker } from '@/components/ui/TimePicker';

/** The three pickers in the dev gallery: select, time, date. */
export function PickersDemo() {
  const t = useTranslations('dev.ui');
  const [service, setService] = useState('haircut');
  const [time, setTime] = useState('09:00');
  const [date, setDate] = useState('2026-11-12');
  return (
    <>
      <Select
        label={t('fields.service')}
        hint={t('fields.serviceHint')}
        value={service}
        onChange={setService}
        options={[
          { value: 'haircut', label: t('fields.haircut') },
          { value: 'blowDry', label: t('fields.blowDry') },
        ]}
      />
      <div className="grid grid-cols-2 gap-3">
        <TimePicker label={t('fields.time')} value={time} onChange={setTime} />
        <DatePicker label={t('fields.date')} value={date} onChange={setDate} />
      </div>
    </>
  );
}
