export type TextPart = {
  type: "text";
  text: string;
};

export type ImageUrlPart = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "low" | "high" | "auto";
  };
};

export type VideoUrlPart = {
  type: "video_url";
  video_url: {
    url: string;
  };
};

export type ContentPart = TextPart | ImageUrlPart | VideoUrlPart;

export type RunInputBody = {
  content?: unknown;
  stream?: unknown;
};
