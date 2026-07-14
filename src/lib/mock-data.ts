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
