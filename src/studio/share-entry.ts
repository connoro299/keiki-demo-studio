import { handleShare } from "./share-server";

/** Vercel function entry, bundled to api/share.mjs by scripts/build-api.mjs. */
export function GET(request: Request): Promise<Response> {
  return handleShare(request);
}
export function POST(request: Request): Promise<Response> {
  return handleShare(request);
}
