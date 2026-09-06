import { useState, type ComponentType } from "react";
import { useLocation } from "react-router-dom";
import { ChatPage } from "@/src/pages/chat-page";
import { DocumentsStudio } from "@/components/documents-studio";
import { ResearchStudio } from "@/components/research-studio";
import { FinanceStudio } from "@/components/finance-studio";
import { DataStudio } from "@/components/data-studio";
import { ImagesStudio } from "@/components/images-studio";
import { VideosStudio } from "@/components/videos-studio";
import { PresentationsStudio } from "@/components/presentations-studio";

const WORK_MODE_COMPONENTS: Record<string, ComponentType> = {
  "/chat": ChatPage,
  "/documents": DocumentsStudio,
  "/research": ResearchStudio,
  "/finance": FinanceStudio,
  "/data": DataStudio,
  "/images": ImagesStudio,
  "/videos": VideosStudio,
  "/presentations": PresentationsStudio,
};

const WORK_MODE_PATHS = Object.keys(WORK_MODE_COMPONENTS);

/**
 * Keep visited work-mode pages mounted (hidden when inactive) so in-flight
 * UI/SSE state survives rail switches. No product session cap.
 */
export function WorkModeKeepAlive() {
  const { pathname } = useLocation();
  const [visited, setVisited] = useState<string[]>(() =>
    WORK_MODE_PATHS.includes(pathname) ? [pathname] : [],
  );

  let shown = visited;
  if (WORK_MODE_PATHS.includes(pathname) && !visited.includes(pathname)) {
    shown = [...visited, pathname];
    setVisited(shown);
  }

  return (
    <>
      {shown.map((path) => {
        const Page = WORK_MODE_COMPONENTS[path];
        if (!Page) {
          return null;
        }
        const active = pathname === path;
        return (
          <div
            key={path}
            hidden={!active}
            className={active ? "absolute inset-0 min-h-0 overflow-hidden" : "hidden"}
            aria-hidden={!active}
          >
            <Page />
          </div>
        );
      })}
    </>
  );
}
