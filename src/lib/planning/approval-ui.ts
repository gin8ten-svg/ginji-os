export function approvalModalOpenAfterResult(result: 'success' | 'failure'): boolean {
  return result === 'failure';
}

export function canCloseApprovalModal(loading: boolean): boolean {
  return !loading;
}
