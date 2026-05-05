export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

const isInvalidLocalOAuthPortal = (oauthPortalUrl: string) => {
  try {
    const url = new URL(oauthPortalUrl);
    return ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return true;
  }
};

// Generate login URL at runtime so redirect URI reflects the current origin.
export const getLoginUrl = () => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;

  if (!oauthPortalUrl || !appId || isInvalidLocalOAuthPortal(oauthPortalUrl)) {
    return null;
  }

  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};
