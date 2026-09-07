import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/app-shell';
import { TaskDataProvider } from '@/components/task-data-provider';

export const metadata: Metadata = {
  title: 'Ginji OS',
  description: 'ToDoと固定予定から毎日の実行計画を組み立てる、個人向けスケジュール管理アプリ。',
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
