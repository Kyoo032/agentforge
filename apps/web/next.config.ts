import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(configDir, "../.."),
  transpilePackages: [
    "@agentforge/core",
    "@agentforge/db",
    "@agentforge/university",
    "@agentforge/marketing",
    "@agentforge/legal",
  ],
  serverExternalPackages: ["better-sqlite3"],
  webpack: (config, { isServer, webpack }) => {
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
        resource.request = resource.request.replace(/^node:/, "");
      }),
    );
    const nodeBuiltins = ["crypto", "fs", "path", "async_hooks", "os", "url", "module"];
    if (isServer) {
      const extraExternal = ({ request }: { request?: string }, cb: (err?: Error | null, result?: string) => void) => {
        const name = request?.replace(/^node:/, "");
        if (name && nodeBuiltins.includes(name)) {
          cb(null, `commonjs ${name}`);
          return;
        }
        cb();
      };
      config.externals = [
        ...(Array.isArray(config.externals)
          ? config.externals
          : config.externals
            ? [config.externals]
            : []),
        extraExternal,
      ];
    } else {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        fs: false,
        path: false,
        async_hooks: false,
        os: false,
        url: false,
        module: false,
      };
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
