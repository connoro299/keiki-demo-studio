import { z } from "zod";
import { demoFlowSchema, platformSchema, type CompiledEvent, type DemoFlow, type DemoMessage, type DemoPlatform } from "@/contracts";

export const checkpointSchema = z.object({
  id: z.string().min(1),
  atMs: z.number().int(),
});

export const authoringDocumentSchema = demoFlowSchema.extend({
  targets: z.array(platformSchema).min(1).optional(),
  checkpoints: z.array(checkpointSchema).optional(),
}).strict();

export type AuthoringDocument = z.infer<typeof authoringDocumentSchema>;

export function toDemoFlow(document: AuthoringDocument, platform: DemoPlatform): DemoFlow {
  return {
    id: document.id,
    title: document.title,
    platform,
    ...(document.channel ? { channel: document.channel } : {}),
    theme: document.theme,
    contact: document.contact,
    nowMs: document.nowMs,
    ...(document.startAtMs !== undefined ? { startAtMs: document.startAtMs } : {}),
    draft: document.draft,
    typing: document.typing,
    screen: document.screen,
    messages: document.messages as DemoMessage[],
    ...(document.events ? { events: document.events as CompiledEvent[] } : {}),
    ...(document.participants ? { participants: document.participants } : {}),
    ...(document.group ? { group: document.group } : {}),
    ...(document.conversations ? { conversations: document.conversations } : {}),
    ...(document.selectedConversationId ? { selectedConversationId: document.selectedConversationId } : {}),
    ...(document.library ? { library: document.library } : {}),
  };
}

export function declaredTargets(document: AuthoringDocument, constraint?: DemoPlatform): DemoPlatform[] {
  const declared = document.targets ?? [document.platform];
  if (!constraint) return [...declared];
  if (!declared.includes(constraint)) return [];
  return [constraint];
}
