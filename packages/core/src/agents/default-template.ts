import type { InputModality } from "../tenancy/types";
import {
  DEFAULT_CHAT_MODALITIES,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CHAT_PROMPT,
  DEFAULT_CHAT_TOOLS,
} from "./default-chat";
import { LEGACY_PRODUCT_MODES, type ProductMode } from "./product-modes";

export type AgentTemplate = {
  key: string;
  pack: string;
  packLabel: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  inputModalities: InputModality[];
  productModes: ProductMode[];
  toolKeys: string[];
};

export type AgentPack = {
  id: string;
  label: string;
  templates: AgentTemplate[];
};

export const DEFAULT_PACK_ID = "default";
export const DEFAULT_TEMPLATE_KEY = "default";

export const defaultAgentTemplate: AgentTemplate = {
  key: DEFAULT_TEMPLATE_KEY,
  pack: DEFAULT_PACK_ID,
  packLabel: "Default",
  name: "Assistant",
  description: "General starter with search, calculator, and image/video tools. Ready the first time you open the app.",
  systemPrompt: DEFAULT_CHAT_PROMPT,
  model: DEFAULT_CHAT_MODEL,
  inputModalities: [...DEFAULT_CHAT_MODALITIES],
  productModes: [...LEGACY_PRODUCT_MODES],
  toolKeys: [...DEFAULT_CHAT_TOOLS],
};

export const defaultAgentPack: AgentPack = {
  id: DEFAULT_PACK_ID,
  label: "Default",
  templates: [defaultAgentTemplate],
};
