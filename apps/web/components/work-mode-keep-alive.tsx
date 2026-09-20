import { useState, type ComponentType } from "react";
import { useLocation } from "react-router-dom";
import { ChatPage } from "@/src/pages/chat-page";
import { DocumentsStudio } from "@/components/documents-studio";
import { ResearchStudio } from "@/components/research-studio";
import { FinanceStudio } from "@/components/finance-studio";
import { DataStudio } from "@/components/data-studio";
import { MarketStudio } from "@/components/market-studio";
import { ImagesStudio } from "@/components/images-studio";
import { VideosStudio } from "@/components/videos-studio";
import { MusicStudio } from "@/components/music-studio";
import { EditStudio } from "@/components/edit-studio";
import { PresentationsStudio } from "@/components/presentations-studio";
import { LegalStudio } from "@/components/legal-studio";
import { MeetingStudio } from "@/components/meeting-studio";
import { useWorkspaceScope } from "@/lib/workspace-scope";

const WORK_MODE_COMPONENTS: Record<string, ComponentType> = {
  "/chat": ChatPage,
  "/documents": DocumentsStudio,
  "/research": ResearchStudio,
  "/finance": FinanceStudio,
  "/data": DataStudio,
  "/market": MarketStudio,
  "/images": ImagesStudio,
  "/videos": VideosStudio,
  "/music": MusicStudio,
  "/edit": EditStudio,
  "/presentations": PresentationsStudio,
  "/legal": LegalStudio,
  "/meeting": MeetingStudio,
};

const WORK_MODE_PATHS = Object.keys(WORK_MODE_COMPONENTS);

/**
 * Keep visited work-mode pages mounted (hidden when inactive) so in-flight
 * UI/SSE state survives rail switches. No product session cap.
 *
 * The active pane is `absolute inset-0` so Chat/Edit can `h-full` and scroll
 * internally. It must be `overflow-y-auto`, not `overflow-hidden`: Research,
 * Finance, Data, Documents, Images, Videos, and Presentation grow past the
 * pane and have no inner scroller — Music included.
 */
export function WorkModeKeepAlive() {
  const { id } = useWorkspaceScope();
  return <WorkModePanes key={id ?? "boot"} />;
}

function WorkModePanes() {
  const { pathname } = useLocation();
  const [visited, setVisited] = useState<string[]>(() => (WORK_MODE_PATHS.includes(pathname) ? [pathname] : []));

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
            className={active ? "absolute inset-0 min-h-0 overflow-y-auto" : "hidden"}
            aria-hidden={!active}
          >
            <Page />
          </div>
        );
      })}
    </>
  );
}
