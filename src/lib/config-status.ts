export type ConfigVariant = "info" | "warning" | "error";

export interface ConfigStatus {
  name: string;
  configured: boolean;
  variant: ConfigVariant;
  message: string;
  docsUrl?: string;
  docsLabel?: string;
}

export const configStatuses: ConfigStatus[] = [];

export const missingConfigs = configStatuses.filter((s) => !s.configured);
