import StatusPanel from "@/components/StatusPanel";
import ChatPanel from "@/components/ChatPanel";
import ActivityPanel from "@/components/ActivityPanel";

export default function DashboardPage() {
  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0e1a] text-slate-200">
      {/* Left navigation */}
      <aside className="w-56 flex-shrink-0 border-r border-slate-800 bg-[#0d1120] flex flex-col">
        <div className="px-5 py-6 border-b border-slate-800">
          <h1 className="text-xl font-bold tracking-widest text-cyan-400 uppercase">
            Jarvis
          </h1>
          <p className="text-xs text-slate-500 mt-1">Local-first AI assistant</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavItem label="Dashboard" active />
          <NavItem label="Chat" />
          <NavItem label="Memory" disabled />
          <NavItem label="Files" disabled />
          <NavItem label="Settings" disabled />
        </nav>

        <div className="px-5 py-4 border-t border-slate-800 text-xs text-slate-600">
          v0.1.0 — skeleton
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Chat area */}
        <section className="flex-1 flex flex-col border-r border-slate-800">
          <ChatPanel />
        </section>

        {/* Right activity panel */}
        <aside className="w-72 flex-shrink-0 flex flex-col">
          <StatusPanel />
          <ActivityPanel />
        </aside>
      </main>
    </div>
  );
}

// Simple nav item — no router dependency needed at this stage
function NavItem({
  label,
  active,
  disabled,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  const base = "w-full text-left px-3 py-2 rounded text-sm transition-colors";
  const styles = disabled
    ? `${base} text-slate-600 cursor-not-allowed`
    : active
    ? `${base} bg-cyan-500/10 text-cyan-400 font-medium`
    : `${base} text-slate-400 hover:bg-slate-800 hover:text-slate-200`;

  return (
    <button className={styles} disabled={disabled}>
      {label}
    </button>
  );
}
