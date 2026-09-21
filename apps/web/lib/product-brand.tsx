import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_PRODUCT_NAME, GATEWAY_BASE_URL, GATEWAY_NAME } from "@agentforge/core/gateway";
import { getDesktopBrand, getDesktopBrandLogo, isElectron } from "@/lib/api-client";
import { pingOnce } from "@/lib/host-ping";

export type ProductBrand = {
  productName: string;
  gatewayName: string;
  gatewayBaseUrl: string;
  logoSrc: string;
};

export const DEFAULT_PRODUCT_BRAND: ProductBrand = {
  productName: DEFAULT_PRODUCT_NAME,
  gatewayName: GATEWAY_NAME,
  gatewayBaseUrl: GATEWAY_BASE_URL,
  logoSrc: "",
};

const BrandContext = createContext<ProductBrand>(DEFAULT_PRODUCT_BRAND);

export function useProductBrand(): ProductBrand {
  return useContext(BrandContext);
}

export function gatewayHostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function brandFromUnknown(payload: unknown, fallback: ProductBrand): ProductBrand {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }
  const record = payload as Record<string, unknown>;
  const nested =
    record.body && typeof record.body === "object" ? (record.body as Record<string, unknown>) : record;
  const productName =
    typeof nested.productName === "string" && nested.productName.trim()
      ? nested.productName.trim()
      : fallback.productName;
  const gatewayName =
    typeof nested.gatewayName === "string" && nested.gatewayName.trim()
      ? nested.gatewayName.trim()
      : fallback.gatewayName;
  const gatewayBaseUrl =
    typeof nested.gatewayBaseUrl === "string" && nested.gatewayBaseUrl.trim()
      ? nested.gatewayBaseUrl.trim()
      : fallback.gatewayBaseUrl;
  return { ...fallback, productName, gatewayName, gatewayBaseUrl };
}

export function mergePingBrand(current: ProductBrand, payload: unknown): ProductBrand {
  const next = brandFromUnknown(payload, current);
  const keepPreloadName =
    current.productName !== DEFAULT_PRODUCT_BRAND.productName &&
    next.productName === DEFAULT_PRODUCT_BRAND.productName;
  const keepPreloadGateway =
    current.gatewayName !== DEFAULT_PRODUCT_BRAND.gatewayName &&
    next.gatewayName === DEFAULT_PRODUCT_BRAND.gatewayName;
  return {
    ...next,
    productName: keepPreloadName ? current.productName : next.productName,
    gatewayName: keepPreloadGateway ? current.gatewayName : next.gatewayName,
    gatewayBaseUrl: keepPreloadName ? current.gatewayBaseUrl : next.gatewayBaseUrl,
    logoSrc: current.logoSrc || next.logoSrc,
  };
}

function preloadBrand(): ProductBrand {
  if (!isElectron()) {
    return DEFAULT_PRODUCT_BRAND;
  }
  return {
    ...brandFromUnknown(getDesktopBrand(), DEFAULT_PRODUCT_BRAND),
    logoSrc: getDesktopBrandLogo() ?? "",
  };
}

export function ProductBrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState(preloadBrand);

  useEffect(() => {
    document.title = brand.productName;
  }, [brand.productName]);

  useEffect(() => {
    // Phase 8: one shared `/api/v1/ping`, because the capabilities provider reads the same payload.
    // Two fetches would race to mint the CSRF cookie and one of them would lose its token.
    void pingOnce().then((payload) => {
      if (payload !== null) {
        setBrand((current) => mergePingBrand(current, payload));
      }
      // A null payload is a failed ping: the packaged preload already supplied the flavor and
      // webdev keeps the defaults, exactly as the old `.catch` left them.
    });
  }, []);

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}
