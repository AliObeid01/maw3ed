'use client';

import { CircleAlert, ImagePlus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { BusinessAvatar } from '@/components/ui/BusinessAvatar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api/auth';
import { removeLogo, uploadLogo } from '@/lib/api/setup';
import { checkLogoFile, LOGO_ACCEPT, prepareLogo, type PreparedLogo } from '@/lib/setup/logoImage';
import { ConfirmSheet } from '../ConfirmSheet';
import { useSharedText } from '../states';
import { useShellLogo } from '../SessionContext';

type ErrorKey = 'unsupported' | 'invalid' | 'tooLarge' | 'rateLimited' | 'forbidden' | 'generic';

/** Maps an API failure to the Logo section's own copy (the server's message text is never shown). */
function logoErrorKey(error: unknown): ErrorKey {
  if (!(error instanceof ApiError)) return 'generic';
  if (error.code === 'UNSUPPORTED_IMAGE') return 'unsupported';
  if (error.code === 'INVALID_IMAGE') return 'invalid';
  if (error.code === 'IMAGE_TOO_LARGE' || error.status === 413) return 'tooLarge';
  if (error.status === 429) return 'rateLimited';
  if (error.status === 403) return 'forbidden';
  return 'generic';
}

/**
 * Settings > Business: the logo. Shows the current logo (or the initials), lets the owner pick a PNG / JPEG / WebP of
 * up to 3 MB, previews the centre-cropped square, then saves it. The picture is cropped and scaled down to at most
 * 512 px in the browser before it is sent (the server re-encodes it anyway). Saving updates the sidebar chip at once.
 */
export function LogoSection({
  businessName,
  logoUrl,
}: {
  businessName: string;
  logoUrl: string | null;
}) {
  const t = useTranslations('app.settings.logo');
  const shared = useSharedText();
  const closeLabel = useTranslations('app.frame')('close');
  const toast = useToast();
  const shell = useShellLogo();
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<string | null>(logoUrl);
  const [prepared, setPrepared] = useState<PreparedLogo | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);

  // Release the preview's object URL when it is replaced or the section unmounts.
  useEffect(() => {
    const url = prepared?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [prepared]);

  const busy = preparing || saving || removing;

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // the same file can be chosen again after a cancel
    if (!file) return;
    setError(null);
    const problem = checkLogoFile(file);
    if (problem) {
      setPrepared(null);
      setError(problem);
      return;
    }
    setPreparing(true);
    try {
      setPrepared(await prepareLogo(file));
    } catch {
      setPrepared(null);
      setError('invalid');
    } finally {
      setPreparing(false);
    }
  };

  const save = async () => {
    if (!prepared || busy) return;
    setSaving(true);
    setError(null);
    try {
      const result = await uploadLogo(prepared.base64);
      setCurrent(result.logoUrl);
      shell.setLogoUrl(result.logoUrl);
      setPrepared(null);
      toast.show(t('saved'));
    } catch (e) {
      setError(logoErrorKey(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setRemoving(true);
    setError(null);
    try {
      await removeLogo();
      setCurrent(null);
      shell.setLogoUrl(null);
      setConfirmOpen(false);
      toast.show(t('removed'));
    } catch (e) {
      setConfirmOpen(false);
      setError(logoErrorKey(e));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div role="group" aria-labelledby={`${uid}-label`} className="flex flex-col gap-3">
      <span id={`${uid}-label`} className="text-[15px] font-medium">
        {t('label')}
      </span>

      <div className="flex items-center gap-4">
        {prepared ? (
          // Preview of what will be stored: the centre square of the picture.
          // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL
          <img
            src={prepared.previewUrl}
            alt={businessName}
            width={96}
            height={96}
            className="block size-24 shrink-0 rounded-tile border border-divider bg-surface object-cover"
          />
        ) : (
          <BusinessAvatar name={businessName} logoUrl={current} size={64} tone="brand" decorative={false} />
        )}
        <div className="flex min-w-0 flex-col gap-2">
          {prepared ? (
            <>
              <p className="m-0 text-[13px] text-muted">{t('cropHint')}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="md" loading={saving} onClick={save}>
                  {saving ? shared.saving : t('save')}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  disabled={saving}
                  onClick={() => {
                    setPrepared(null);
                    setError(null);
                  }}
                >
                  {shared.cancel}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="md"
                loading={preparing}
                disabled={busy && !preparing}
                onClick={() => inputRef.current?.click()}
              >
                <ImagePlus size={18} aria-hidden="true" />
                {preparing ? t('preparing') : current ? t('change') : t('upload')}
              </Button>
              {current ? (
                <Button
                  variant="ghost"
                  size="md"
                  disabled={busy}
                  onClick={() => setConfirmOpen(true)}
                >
                  <Trash2 size={18} aria-hidden="true" />
                  {t('remove')}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={LOGO_ACCEPT}
        aria-label={t('inputLabel')}
        tabIndex={-1}
        className="sr-only"
        onChange={onPick}
      />

      <p className="m-0 text-[13px] text-muted">{current || prepared ? t('hint') : t('empty')}</p>

      {error ? (
        <div role="alert">
          <Callout tone="danger" icon={<CircleAlert />}>
            {t(`errors.${error}`)}
          </Callout>
        </div>
      ) : null}

      <ConfirmSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('removeTitle')}
        description={t('removeBody')}
        confirmLabel={t('removeConfirm')}
        cancelLabel={t('keep')}
        closeLabel={closeLabel}
        pending={removing}
        onConfirm={remove}
      />
    </div>
  );
}
