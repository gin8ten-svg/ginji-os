export type SubmissionResult = { started: false } | { started: true; error: string | null };
export class SubmissionGate {
  private pending = false;
  async run(operation: () => Promise<void>): Promise<SubmissionResult> {
    if (this.pending) return { started: false };
    this.pending = true;
    try { await operation(); return { started: true, error: null }; }
    catch (error) { return { started: true, error: error instanceof Error ? error.message : '保存できませんでした。' }; }
    finally { this.pending = false; }
  }
}
