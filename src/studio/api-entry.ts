import { handleMake } from "./server";

/** Vercel function entry, bundled to api/make.mjs by scripts/build-api.mjs. */
export const config = { maxDuration: 300 };
export function POST(request: Request): Promise<Response> {
  return handleMake(request);
}
