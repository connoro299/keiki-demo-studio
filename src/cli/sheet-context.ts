import { readFileSync, realpathSync, existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { planHumanRequest, type SheetValidationContext } from '@/generator/sheet-request';
import { inspectAsset } from './preflight';
import type { ParsedArgs } from './args';
export function sheetContext(args: Pick<ParsedArgs, 'humanRequest' | 'sheetExperience'>, repoRoot: string): SheetValidationContext {
  // The CLI caller is the trusted human-input adapter. Never read a receipt/source flag from a flow,
  // sheet plan, web page or model response. Keep the original human text in a separate input channel.
  const text = args.humanRequest ? readFileSync(path.resolve(args.humanRequest), 'utf8') : '';
  return {
    request: planHumanRequest({ role: 'human', text, experienceQuote: args.sheetExperience }),
    resolveAsset: src => inspectAsset(src, repoRoot),
    resolveContent: (entry, actions) => {
      if (!/^\/demo-apps\/(?:[\w-]+\/)*[\w-]+\.html$/.test(entry)) return false;
      const root = realpathSync(path.join(repoRoot, 'public'));
      const file = path.join(root, entry.slice(1));
      if (!existsSync(file) || !realpathSync(file).startsWith(root + path.sep) || !lstatSync(file).isFile()) return false;
      const html = readFileSync(file, 'utf8');
      const manifest = html.match(/<script\s+type="application\/json"\s+id="sheet-app-manifest">([\s\S]*?)<\/script>/)?.[1];
      if (!manifest || !html.includes('sheet-app:ready') || !html.includes('sheet-app:presentation')) return false;
      const data = JSON.parse(manifest);
      return data.protocol === 1 && (actions ?? []).every(action => data.actions?.some((item: { id: string; handler: string }) => item.id === action.id && item.handler === action.handler));
    },
  };
}
