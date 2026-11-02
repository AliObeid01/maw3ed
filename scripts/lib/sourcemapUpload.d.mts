export type SourcemapUploadDecision = {
  enabled: boolean;
  reason: string;
  warnings: string[];
  sentryUrl?: string;
  org?: string;
  project?: string;
  release?: string;
};
export function sentryUrlFromDsn(dsn: string | undefined): string | undefined;
export function resolveSourcemapUpload(env: Record<string, string | undefined>): SourcemapUploadDecision;
export function describeUploadFailure(error: unknown, secrets?: (string | undefined)[]): string;
export function sourcemapBuildOptions(
  env: Record<string, string | undefined>,
  warn?: (message: string) => void,
): {
  authToken?: string;
  org?: string;
  project?: string;
  sentryUrl?: string;
  sourcemaps: { disable: true } | { deleteSourcemapsAfterUpload: true };
  release: { name?: string; create: false; finalize: false };
  errorHandler?: (error: Error) => void;
};
