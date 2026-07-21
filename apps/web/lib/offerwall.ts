// AdGem hosted offerwall embed. AdGem renders the offer catalog + tracks
// completions inside the iframe; when a user completes an offer AdGem calls our
// server-to-server postback (/postback/adgem), which credits the wallet.
//
// The appid is not a secret (it's in the wall URL the browser loads), so it's a
// plain env var on the web app. Set ADGEM_APP_ID to go live; unset = setup card.

const WALL_BASE = process.env.ADGEM_WALL_URL ?? "https://api.adgem.com/v1/wall";

export type Wall = {
  key: string;
  name: string;
  blurb: string;
  color: string;
  configured: boolean;
  url: string | null;
};

export function adgemWall(userId: string): Wall {
  const appId = process.env.ADGEM_APP_ID;
  return {
    key: "adgem",
    name: "AdGem",
    blurb: "Games, apps & sign-ups. High-paying offers updated daily.",
    color: "#0ea5e9",
    configured: !!appId,
    url: appId
      ? `${WALL_BASE}?appid=${encodeURIComponent(appId)}&playerid=${encodeURIComponent(userId)}`
      : null,
  };
}
