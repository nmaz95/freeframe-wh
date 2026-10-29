"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { useUploadStore } from "@/stores/upload-store";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { MobileHeader } from "@/components/layout/mobile-header";
import { MobileTabBar, TAB_BAR_PX } from "@/components/layout/mobile-tab-bar";
import { CommandPalette } from "@/components/layout/command-palette";
import { KeyboardShortcuts } from "@/components/layout/keyboard-shortcuts";
import { UploadsPanel } from "@/components/layout/uploads-panel";
import { UploadSSEBridge } from "@/components/layout/upload-sse-bridge";
import { PoweredByBadge } from "@/components/shared/powered-by-badge";
import { useUploadLeaveGuard } from "@/hooks/use-upload-leave-guard";
import { refuseFileDrag } from "@/lib/drag";
import { cn } from "@/lib/utils";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(true);
  const [commandOpen, setCommandOpen] = React.useState(false);
  const { fetchUser } = useAuthStore();
  const fetchHistory = useUploadStore((s) => s.fetchHistory);

  // Ask the browser to confirm before the tab goes away with uploads in it.
  useUploadLeaveGuard();

  // The asset viewer renders its own top bar, carrying both the header's role
  // and the attribution credit, so the shell supplies neither here.
  const isAssetViewer = /\/projects\/[^/]+\/assets\/[^/]+/.test(pathname);

  React.useEffect(() => {
    fetchUser();
    fetchHistory();
  }, [fetchUser, fetchHistory]);

  // Global keyboard shortcut for command palette
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    // The shell refuses a file drag nothing inside it took. Every drop target
    // stops the event when it accepts, so anything arriving here was wanted by
    // nobody, and the browser's own handling of it navigates the tab to the
    // file. The rail, the header and the attribution badge are all siblings of
    // the page rather than parts of it, and the badge in particular floats over
    // the asset area a project page offers as a drop target -- releasing a few
    // pixels off it used to load `file:///...` over the session.
    <div
      className="flex h-dvh overflow-hidden bg-bg-primary pl-safe pr-safe"
      onDragOver={refuseFileDrag}
      onDrop={refuseFileDrag}
    >
      {/* The rail and the header are the desktop shell. Below `md` the phone
          shell takes their place: a capsule header floating over the page and
          a tab bar along the bottom edge. Both shells stay mounted and CSS
          picks one, so a rotation or a resize never remounts the page. The
          asset viewer renders its own chrome in either case. */}
      <div className="contents max-md:hidden">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((c) => !c)}
        />
      </div>

      {/* Main content area */}
      <main
        className={cn(
          "relative flex flex-1 flex-col overflow-hidden transition-[margin] duration-200 ease-spring max-md:ml-0",
          sidebarCollapsed ? "ml-[52px]" : "ml-[220px]",
        )}
      >
        {!isAssetViewer && (
          <div className="contents max-md:hidden">
            <Header onSearchOpen={() => setCommandOpen(true)} />
          </div>
        )}
        {!isAssetViewer && (
          <div className="pointer-events-none absolute inset-x-3 top-safe [--ff-top:0.5rem] z-30 md:hidden">
            <MobileHeader onSearchOpen={() => setCommandOpen(true)} />
          </div>
        )}

        <div
          className={cn(
            "relative flex-1 overflow-y-auto",
            // The page scrolls under the floating chrome, so it starts below
            // the capsule and ends above the tab bar. Only on the phone shell.
            !isAssetViewer && "max-md:pt-safe-plus max-md:[--ff-pt:4.5rem] max-md:pb-tabbar max-md:[--ff-tabbar:5rem]",
          )}
        >
          {children}
        </div>
      </main>

      {!isAssetViewer && (
        <div className="md:hidden" style={{ ["--ff-tabbar" as string]: `${TAB_BAR_PX}px` }}>
          <MobileTabBar onSearchOpen={() => setCommandOpen(true)} searchOpen={commandOpen} />
        </div>
      )}

      {/* Attribution floats over the content rather than living in the sidebar,
          so it stays put whether the rail is collapsed or expanded and doesn't
          compete with the org name for the 48px logo header. Renders nothing
          when an admin turns "Powered by FreeFrame" off.

          Not on the asset viewer. That route carries its own credit in the top
          bar it renders in place of the header, so the floating one was a
          second copy -- and at 173px wide it covered the 28px send button in
          the corner of the comment composer completely, so every click on Send
          opened the repository in a new tab instead of posting the comment.
          Enter still posted, which is why it went unseen.

          The viewer's own copy is hidden below `lg`, where it would push the
          bar's controls off the screen. Nothing takes its place there: bringing
          this one back would restore the send-button collision on exactly the
          widths where the composer is hardest to hit. */}
      {/* Not on the phone shell either: the tab bar owns the bottom edge
          there, and the badge floated straight over the last row of cards. */}
      {!isAssetViewer && (
        <PoweredByBadge className="fixed bottom-safe right-safe [--ff-bottom:1rem] [--ff-right:1rem] z-20 rounded-full border border-border bg-bg-elevated/90 px-3 py-1.5 shadow-lg backdrop-blur-sm max-md:hidden" />
      )}

      <UploadsPanel railCollapsed={sidebarCollapsed} />
      <UploadSSEBridge />
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      <KeyboardShortcuts standalone />
    </div>
  );
}
