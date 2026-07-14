import { describe, expect, it } from 'vitest';
import { approvalModalOpenAfterResult, canCloseApprovalModal } from '@/lib/planning/approval-ui';

describe('approval modal state', () => {
  it('API成功までは閉じず成功後だけ閉じる', () => { expect(canCloseApprovalModal(true)).toBe(false); expect(approvalModalOpenAfterResult('success')).toBe(false); });
  it('失敗時は開いたままにする', () => expect(approvalModalOpenAfterResult('failure')).toBe(true));
  it('loading中はキャンセル・背景・Escで閉じない', () => expect(canCloseApprovalModal(true)).toBe(false));
});
