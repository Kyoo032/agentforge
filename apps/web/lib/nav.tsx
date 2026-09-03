import {
  Link as RouterLink,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams as useRrSearchParams,
  type LinkProps as RouterLinkProps,
} from "react-router-dom";
import { useMemo, useRef } from "react";

export { useParams };

export function useSearchParams(): URLSearchParams {
  const [params] = useRrSearchParams();
  return params;
}

type LinkProps = Omit<RouterLinkProps, "to"> & {
  href?: string;
  to?: RouterLinkProps["to"];
};

export function Link({ href, to, ...props }: LinkProps) {
  return <RouterLink to={to ?? href ?? "/"} {...props} />;
}

export function usePathname(): string {
  return useLocation().pathname;
}

export function useRouter() {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  return useMemo(
    () => ({
      push: (to: string) => {
        void navigateRef.current(to);
      },
      replace: (to: string) => {
        void navigateRef.current(to, { replace: true });
      },
      refresh: () => {
        window.dispatchEvent(new Event("agentforge-shell-refresh"));
      },
    }),
    [],
  );
}
