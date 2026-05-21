export class ErrorTracker {
  constructor(threshold = 3) {
    this.threshold = threshold;
    this.streak = 0;
    this.lastErrors = [];
  }

  record(status, detail = null) {
    if (this._isError(status)) {
      this.streak++;
      this.lastErrors.push({ status, detail, ts: new Date().toISOString() });
      if (this.lastErrors.length > 10) this.lastErrors.shift();
    } else {
      this.reset();
    }
  }

  reset() {
    this.streak = 0;
  }

  get shouldPause() {
    return this.streak >= this.threshold;
  }

  get errorStreak() {
    return this.streak;
  }

  _isError(status) {
    const errorStatuses = ["permission_denied", "validation_error", "timeout", "network_error", "compose_failed", "submit_failed"];
    return errorStatuses.includes(status);
  }
}