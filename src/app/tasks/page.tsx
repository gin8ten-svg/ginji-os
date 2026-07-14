"use client";

import { useMemo, useState } from 'react';
import { tasks as initialTasks } from '@/lib/mock-data';
import { EmptyState } from '@/components/empty-state';

const tabs = ['Inbox', 'Today', 'Upcoming', 'Overdue', 'Completed'] as const;

type TabKey = (typeof tabs)[number];

function labelToStatus(tab: TabKey) {
  switch (tab) {
    case 'Today':
      return 'today';
    case 'Upcoming':
      return 'upcoming';
    case 'Overdue':
      return 'overdue';
    case 'Completed':
      return 'completed';
    default:
      return 'inbox';
  }
}

export default function TasksPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('Today');
  const [taskList, setTaskList] = useState(initialTasks);

  const visibleTasks = useMemo(() => {
    const status = labelToStatus(activeTab);
    return taskList.filter((task) => task.status === status);
  }, [activeTab, taskList]);

  const toggleComplete = (id: string) => {
    setTaskList((current) =>
      current.map((task) => (task.id === id ? { ...task, completed: !task.completed, status: task.completed ? 'today' : 'completed' } : task)),
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Tasks</h2>
          <button className="rounded-full bg-brand-500 px-3 py-1 text-sm font-medium text-white">新規作成</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${activeTab === tab ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {visibleTasks.length === 0 ? (
          <EmptyState title="このビューはまだ空です" description="新しいタスクを追加して、行動計画を組み立てましょう。" />
        ) : (
          visibleTasks.map((task) => (
            <div key={task.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{task.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{task.description}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{task.category}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span>予想 {task.estimate}</span>
                <span>•</span>
                <span>{task.dueLabel}</span>
                <span>•</span>
                <span>{task.priority}</span>
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={() => toggleComplete(task.id)} className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
                  {task.completed ? '未完了に戻す' : '完了にする'}
                </button>
                <button className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700">編集</button>
                <button className="rounded-full bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700">削除</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
