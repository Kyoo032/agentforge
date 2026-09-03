export type HostCookie = { name: string; value: string; path?: string };

export type HostFile = {
  field: string;
  filename: string;
  mime: string;
  bytes: Uint8Array;
};

export type HostRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  params: Record<string, string>;
  headers: Record<string, string | undefined>;
  body?: unknown;
  files?: HostFile[];
  /** Cookie or host-process selected workspace. */
  workspaceId?: string | null;
};

export type HostJsonResult = {
  type: "json";
  status: number;
  body: unknown;
  cookies?: HostCookie[];
};

export type HostStreamResult = {
  type: "stream";
  status: number;
  events: AsyncIterable<string>;
};

export type HostBytesResult = {
  type: "bytes";
  status: number;
  bytes: Uint8Array;
  contentType: string;
  filename?: string;
};

export type HostResult = HostJsonResult | HostStreamResult | HostBytesResult;

export type HostHandler = (request: HostRequest) => Promise<HostResult>;
