"use client";

import { useEffect, useState } from "react";
import type { JobMode } from "@agentforge/core";
import { apiFetch } from "./api-client";

export type JobStudioModel = {
  id: string;
  label: string;
  provider?: string;
  inputModalities: string[];
  contextLength?: number;
  friendlyLabel?: string;
  bestFor?: string;
  tier?: "everyday" | "advanced";
};

const SETTINGS_KEY: Record<JobMode, "documentGenModel" | "researchGenModel" | "presentationGenModel"> = {
  documents: "documentGenModel",
  research: "researchGenModel",
  presentations: "presentationGenModel",
  finance: "documentGenModel",
  data: "researchGenModel",
  legal: "documentGenModel",
};

export function seedJobModel(input: {
  models: Array<{ id: string }>;
  catalogDefault?: string;
  settingsModel?: string;
}): string {
  const ids = new Set(input.models.map((model) => model.id));
  if (input.settingsModel && ids.has(input.settingsModel)) {
    return input.settingsModel;
  }
  if (input.catalogDefault && ids.has(input.catalogDefault)) {
    return input.catalogDefault;
  }
  return input.models[0]?.id ?? "";
}

function asModels(value: unknown): JobStudioModel[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is JobStudioModel => {
    return Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string");
  });
}

function asString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function useJobModel(mode: JobMode): {
  models: JobStudioModel[];
  model: string;
  setModel: (id: string) => void;
} {
  const [models, setModels] = useState<JobStudioModel[]>([]);
  const [model, setModel] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiFetch("/api/v1/models").then((response) => response.json().catch(() => ({}))),
      apiFetch("/api/v1/settings").then((response) => response.json().catch(() => ({}))),
    ]).then(([catalog, settings]) => {
      if (cancelled) {
        return;
      }
      const list = asModels(
        catalog && typeof catalog === "object"
          ? ((catalog as { modes?: Record<string, unknown> }).modes?.[mode] ??
              (catalog as { models?: unknown }).models)
          : [],
      );
      const catalogDefault = asString(
        catalog && typeof catalog === "object"
          ? (catalog as { defaults?: Record<string, unknown> }).defaults?.[mode]
          : "",
      );
      const settingsModel = asString(
        settings && typeof settings === "object" ? (settings as Record<string, unknown>)[SETTINGS_KEY[mode]] : "",
      );
      setModels(list);
      setModel(seedJobModel({ models: list, catalogDefault, settingsModel }));
    });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  return { models, model, setModel };
}
