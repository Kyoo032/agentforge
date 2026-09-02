import {
  Link as RouterLink,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
  type LinkProps as RouterLinkProps,
} from "react-router-dom";

export { useParams, useSearchParams };

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
  return {
    push: (to: string) => {
      void navigate(to);
    },
    replace: (to: string) => {
      void navigate(to, { replace: true });
    },
    refresh: () => {
      window.dispatchEvent(new Event("agentforge-shell-refresh"));
    },
  };
}
