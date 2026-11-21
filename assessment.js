const LEVELS = [
  {
    id: 1,
    name: 'FAMILIARIZATION',
    description: 'Learn the field and timing at a comfortable pace.',
    trials: 3,
    birdCount: [3, 4, 4],
    speedScale: 0.62,
    timeLimitMs: 120000,
    responseWindowMs: 4200,
    condition: 'go',
    reward: { immediate: 10, delayed: 18 },
  },
  {
    id: 2,
    name: 'BASIC ASSESSMENT',
    description: 'Track mixed birds and choose when to respond.',
    trials: 4,
    birdCount: [5, 6, 5, 7],
    speedScale: 0.82,
    timeLimitMs: 60000,
    responseWindowMs: 3400,
    condition: 'mixed',
    reward: { immediate: 10, delayed: 25 },
  },
  {
    id: 3,
    name: 'INCREASED CHALLENGE',
    description: 'Shorter opportunities demand careful timing.',
    trials: 4,
    birdCount: [6, 7, 8, 7],
    speedScale: 1,
    timeLimitMs: 15000,
    responseWindowMs: 2600,
    condition: 'inhibition',
    reward: { immediate: 12, delayed: 28 },
  },
  {
    id: 4,
    name: 'DECISION CHALLENGE',
    description: 'Balance certain rewards against uncertain opportunities.',
    trials: 4,
    birdCount: [6, 8, 7, 8],
    speedScale: 1.08,
    timeLimitMs: 30000,
    responseWindowMs: 2500,
    condition: 'risk-delay',
    reward: { immediate: 12, delayed: 30 },
  },
  {
    id: 5,
    name: 'ADVANCED ASSESSMENT',
    description: 'Mixed conditions combine timing, inhibition, and accuracy.',
    trials: 5,
    birdCount: [7, 8, 9, 8, 10],
    speedScale: 1.16,
    timeLimitMs: 30000,
    responseWindowMs: 2200,
    condition: 'combined',
    reward: { immediate: 15, delayed: 35 },
  },
];

function createSeededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export class AssessmentController {
  constructor() {
    this.sessionId = `SP-${Date.now().toString(36).toUpperCase()}`;
    this.levelIndex = 0;
    this.trialIndex = 0;
    this.seed = Date.now() >>> 0;
    this.random = createSeededRandom(this.seed);
    this.trial = null;
  }

  get level() {
    return LEVELS[this.levelIndex];
  }

  startLevel(levelIndex = 0) {
    this.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, levelIndex));
    this.trialIndex = 0;
    this.seed = (Date.now() + this.levelIndex * 7919) >>> 0;
    this.random = createSeededRandom(this.seed);
    return this.startTrial();
  }

  startTrial() {
    const level = this.level;
    const condition = this.chooseCondition(level.condition);
    const targetSpecies = ['crow', 'owl', 'eagle'][Math.floor(this.random() * 3)];
    this.trial = {
      sessionId: this.sessionId,
      trialId: `${level.id}-${this.trialIndex + 1}`,
      level: level.id,
      levelName: level.name,
      condition,
      targetSpecies,
      timeLimitMs: level.timeLimitMs,
      birdCount: level.birdCount[this.trialIndex % level.birdCount.length],
      responseWindowMs: level.responseWindowMs,
      stimulusOnset: performance.now(),
      response: null,
    };
    return this.trial;
  }

  chooseCondition(levelCondition) {
    if (levelCondition === 'mixed') return this.random() < 0.35 ? 'inhibit' : 'go';
    if (levelCondition === 'inhibition') return this.random() < 0.55 ? 'inhibit' : 'go';
    if (levelCondition === 'risk-delay') return this.random() < 0.5 ? 'risk' : 'delay';
    if (levelCondition === 'combined') return ['go', 'inhibit', 'risk', 'delay'][Math.floor(this.random() * 4)];
    return levelCondition;
  }

  recordResponse(response) {
    if (!this.trial || this.trial.response) return;
    this.trial.response = {
      ...response,
      responseTimestamp: performance.now(),
      reactionTime: performance.now() - this.trial.stimulusOnset,
    };
    return this.trial.response;
  }

  finishTrial(outcome = {}) {
    if (!this.trial) return null;
    const record = {
      ...this.trial,
      ...outcome,
      trialCompleted: performance.now(),
      levelDifficulty: this.level.speedScale,
    };
    this.trialIndex += 1;
    this.trial = null;
    return record;
  }

  isLevelComplete() {
    return this.trialIndex >= this.level.trials;
  }

  nextLevel() {
    return this.startLevel(Math.min(this.levelIndex + 1, LEVELS.length - 1));
  }
}

export { LEVELS };
