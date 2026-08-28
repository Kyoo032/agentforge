import type { AgentTemplate, AgentPack } from "@agentforge/core";

export const MARKETING_PACK_ID = "marketing";

const marketingTemplate: AgentTemplate = {
  key: "marketing",
  pack: MARKETING_PACK_ID,
  packLabel: "Marketing",
  name: "Marketing",
  description: "Optional starter for campaign copy, stills, short video, and pitch decks.",
  systemPrompt:
    "You are a marketing desk. Write clear campaign copy, briefs, and captions. Stay specific to the brief, keep claims honest, and use image or video tools only when the user wants a visual.",
  model: "gpt-5.6-sol",
  inputModalities: ["text", "image"],
  productModes: ["chat", "documents", "images", "videos", "presentations"],
  toolKeys: ["web_search", "image_generate", "video_generate", "datetime"],
};

export const marketingTemplates: AgentTemplate[] = [marketingTemplate];

export const marketingAgentPacks: AgentPack[] = [
  {
    id: MARKETING_PACK_ID,
    label: "Marketing",
    templates: marketingTemplates,
  },
];
