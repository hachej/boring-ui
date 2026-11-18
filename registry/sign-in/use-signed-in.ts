'use client';

import { useCallback, useEffect, useState } from 'react';
import { signInClient, type Lang, type Me } from './sign-in-client';

/** Who is signed in: `undefined` while asking, `null` when nobody (show the sign-in page), else the person, their role and, for an app's
 *  owners, the address of the app's page in Studio. `refresh` asks again (after a sign-in or a sign-out). */
export function useSignedIn(locale: Lang = 'fr'): { readonly me: Me | null | undefined; readonly refresh: () => void } {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const refresh = useCallback(() => { void signInClient(locale).me().then(setMe); }, [locale]);
  useEffect(refresh, [refresh]);
  return { me, refresh };
}
