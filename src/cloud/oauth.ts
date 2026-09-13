import { z } from 'zod';

export interface GoogleOAuth {
  clientId?: string;
  clientSecret?: string;
}

const desktopClient = z.object({
  clientId: z
    .string()
    .regex(/^[a-zA-Z0-9.-]+\.apps\.googleusercontent\.com$/)
    .max(256),
  clientSecret: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[^\s]+$/),
});

// Build input only: installed-app client configuration is shipped, never user tokens.
export function distributionOAuth(env: NodeJS.ProcessEnv): GoogleOAuth | null {
  const clientId = env.IRORI_BUILD_GOOGLE_CLIENT_ID;
  const clientSecret = env.IRORI_BUILD_GOOGLE_CLIENT_SECRET;
  if (!clientId && !clientSecret) return null;
  const result = desktopClient.safeParse({ clientId, clientSecret });
  if (!result.success)
    throw Error(
      'Distribution Google OAuth requires both a desktop client ID and client secret. Values are omitted.',
    );
  return result.data;
}
