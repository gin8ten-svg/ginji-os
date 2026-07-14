"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navigation = [
  { href: '/today', label: 'Today' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/review', label: 'Review' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col pb-24 md:pb-8">
        <header className="border-b border-slate-200 bg-white/90 px-4 py-4 backdrop-blur sm:px-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-600">Ginji OS</p>
              <h1 className="text-lg font-semibold">Daily planning prototype</h1>
            </div>
            <div className="rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-600">
              Mobile-first UI
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 py-4 sm:px-6 sm:py-6">{children}</main>
        <nav className="fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white/95 backdrop-blur md:static md:mt-4 md:rounded-2xl md:border md:shadow-sm">
          <ul className="mx-auto flex max-w-6xl items-stretch justify-around px-2 py-2 sm:px-4">
            {navigation.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <li key={item.href} className="flex-1">
                  <Link
                    href={item.href}
                    className={`flex flex-col items-center rounded-xl px-3 py-2 text-sm font-medium transition ${
                      active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
