"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Shield, Wallet2, ChevronDown } from "lucide-react";

/**
 * Top-level chrome for the DEX: brand, the Trade/Overview view toggle, network + wallet.
 * Fixed height so /trade can lock to h-screen without the page ever scrolling.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const tabs = [
    { href: "/trade", label: "Trade" },
    { href: "/overview", label: "Overview" },
  ];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0a0a0b] font-sans text-[13px] text-white/85 antialiased">
      <header className="flex h-12 shrink-0 items-center gap-6 border-b border-white/10 bg-[#121319] px-4">
        <Link href="/" className="flex items-center gap-2 no-underline">
          <span className="grid size-6 place-items-center rounded-md bg-[#9d4edd]/15 ring-1 ring-[#9d4edd]/40">
            <Shield className="size-3.5 text-[#9d4edd]" />
          </span>
          <span className="text-[15px] font-bold tracking-tight text-white">
            Margin<span className="text-[#00e5ff]">Guard</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {tabs.map((t) => {
            const active = path === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-md px-3 py-1.5 text-[13px] font-semibold no-underline transition-colors ${
                  active ? "bg-white/10 text-white" : "text-white/45 hover:text-white/80"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        <div className="flex items-center gap-2 rounded-md border border-white/10 px-2.5 py-1.5">
          <span className="size-1.5 rounded-full bg-[#00e5ff] shadow-[0_0_8px_#00e5ff]" />
          <span className="text-[12px] text-white/55">Starknet Mainnet</span>
        </div>

        <button className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12.5px] font-semibold text-white/80 transition-colors hover:bg-white/[0.08]">
          <Wallet2 className="size-3.5" />
          Connect
          <ChevronDown className="size-3 text-white/40" />
        </button>
      </header>

      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}

export default AppShell;
