"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SelectWallet from "@/app/components/client/WalletHandle/SelectWallet";
import styles from "@/app/terminal.module.css";

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
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/trade" className={styles.brand}>
          <span className={styles.brandMark}>MG</span>
          <span>Margin<span className={styles.brandGuard}>Guard</span></span>
        </Link>

        <nav className={styles.nav}>
          {tabs.map((t) => {
            const active = path === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`${styles.navLink} ${active ? styles.navActive : ""}`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        <div className={styles.topSpacer} />

        <div className={styles.network}>
          <span className={styles.networkDot} />
          <span>Starknet Mainnet</span>
        </div>

        <SelectWallet variant="nav" className={styles.connect} />
      </header>

      <main className={styles.content}>{children}</main>
    </div>
  );
}

export default AppShell;
