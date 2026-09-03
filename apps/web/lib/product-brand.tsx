import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { GATEWAY_BASE_URL, GATEWAY_NAME } from "@agentforge/core/gateway";
import { apiFetch } from "@/lib/api-client";

export type ProductBrand = {
  productName: string;
  gatewayName: string;
  gatewayBaseUrl: string;
};

export const DEFAULT_PRODUCT_BRAND: ProductBrand = {
  productName: "Agentforge",
  gatewayName: GATEWAY_NAME,
  gatewayBaseUrl: GATEWAY_BASE_URL,
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

export function ProductBrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState(DEFAULT_PRODUCT_BRAND);

  useEffect(() => {
    void apiFetch("/api/v1/ping")
      .then((res) => res.json())
      .then((payload) => {
        const productName =
          typeof payload.productName === "string" && payload.productName.trim()
            ? payload.productName.trim()
            : DEFAULT_PRODUCT_BRAND.productName;
        const gatewayName =
          typeof payload.gatewayName === "string" && payload.gatewayName.trim()
            ? payload.gatewayName.trim()
            : DEFAULT_PRODUCT_BRAND.gatewayName;
        const gatewayBaseUrl =
          typeof payload.gatewayBaseUrl === "string" && payload.gatewayBaseUrl.trim()
            ? payload.gatewayBaseUrl.trim()
            : DEFAULT_PRODUCT_BRAND.gatewayBaseUrl;
        setBrand({ productName, gatewayName, gatewayBaseUrl });
      })
      .catch(() => {
        // first boot before the host answers
      });
  }, []);

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}
