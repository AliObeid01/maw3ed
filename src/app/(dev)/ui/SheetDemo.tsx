'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';

export function SheetDemo() {
  const t = useTranslations('dev.ui');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('openSheet')}
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t('sheetTitle')}
        description={t('sheetBody')}
        closeLabel={t('sheetClose')}
      >
        <Button block size="lg" onClick={() => setOpen(false)}>
          {t('sheetClose')}
        </Button>
      </Sheet>
    </>
  );
}
