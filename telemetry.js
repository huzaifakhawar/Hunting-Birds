export class TelemetryStore {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.events = [];
    this.trials = [];
  }

  event(type, payload = {}) {
    const record = {
      sessionId: this.sessionId,
      type,
      timestamp: performance.now(),
      ...payload,
    };
    this.events.push(record);
    return record;
  }

  trial(record) {
    const stored = {
      sessionId: this.sessionId,
      ...record,
    };
    this.trials.push(stored);
    return stored;
  }

  exportPayload(extra = {}) {
    return {
      schemaVersion: '1.0.0',
      sessionId: this.sessionId,
      exportedAt: new Date().toISOString(),
      trials: this.trials,
      events: this.events,
      ...extra,
    };
  }
}
