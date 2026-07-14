import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/app-shell';
import { TaskDataProvider } from '@/components/task-data-provider';

export const metadata: Metadata = {
  title: 'Ginji OS',
  description: 'A mobile-first planning prototype for daily task orchestration.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <TaskDataProvider>
          <AppShell>{children}</AppShell>
        </TaskDataProvider>
      </body>
    </html>
  );
}
