export type TaskStatus = 'inbox' | 'today' | 'upcoming' | 'overdue' | 'completed';

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  category: string;
  priority: 'high' | 'medium' | 'low';
  estimate: string;
  dueLabel: string;
  completed?: boolean;
}

export interface TimelineItem {
  time: string;
  title: string;
  type: 'fixed' | 'ai';
  note?: string;
}

export interface ReviewItem {
  label: string;
  planned: string;
  actual: string;
  rate: string;
}

export const tasks: TaskItem[] = [
  {
    id: '1',
    title: '営業資料の修正',
    description: '顧客向け提案資料の表紙を更新',
    status: 'today',
    category: 'Work',
    priority: 'high',
    estimate: '60m',
    dueLabel: '今日',
  },
  {
    id: '2',
    title: '英語の復習',
    description: '単語を30分だけ確認',
    status: 'today',
    category: 'Learning',
    priority: 'medium',
    estimate: '30m',
    dueLabel: '今日',
  },
  {
    id: '3',
    title: '家計の見直し',
    description: '先月の支出をざっと確認',
    status: 'upcoming',
    category: 'Life',
    priority: 'low',
    estimate: '20m',
    dueLabel: '明日',
  },
  {
    id: '4',
    title: 'ポートフォリオ更新',
    description: '最新の成果を追加',
    status: 'overdue',
    category: 'Work',
    priority: 'high',
    estimate: '90m',
    dueLabel: '昨日',
  },
  {
    id: '5',
    title: '読書',
    description: '技術書を20分読む',
    status: 'completed',
    category: 'Learning',
    priority: 'low',
    estimate: '20m',
    dueLabel: '完了',
    completed: true,
  },
];

export const timeline: TimelineItem[] = [
  { time: '09:00', title: '朝会', type: 'fixed', note: 'チーム共有' },
  { time: '10:00', title: 'AI作業枠', type: 'ai', note: '営業資料の修正' },
  { time: '11:30', title: '昼休み', type: 'fixed' },
  { time: '13:00', title: '英語の復習', type: 'ai', note: '短い集中作業' },
  { time: '15:00', title: '空き時間', type: 'fixed' },
];

export const reviewData: ReviewItem[] = [
  { label: '計画時間', planned: '4h 30m', actual: '3h 50m', rate: '86%' },
  { label: '実績時間', planned: '4h 00m', actual: '3h 20m', rate: '83%' },
  { label: '完了率', planned: '80%', actual: '75%', rate: '94%' },
  { label: '持ち越し', planned: '2', actual: '1', rate: '50%' },
];
