export class TestClock {
  #now: Date;

  constructor(initial: string) {
    this.#now = new Date(initial);
    if (Number.isNaN(this.#now.getTime())) throw new Error(`Invalid test clock timestamp: ${initial}`);
  }

  now(): Date {
    return new Date(this.#now);
  }

  iso(): string {
    return this.#now.toISOString();
  }

  set(value: string): void {
    const next = new Date(value);
    if (Number.isNaN(next.getTime())) throw new Error(`Invalid test clock timestamp: ${value}`);
    this.#now = next;
  }

  advance(duration: { days?: number; hours?: number; minutes?: number; milliseconds?: number }): void {
    const milliseconds = (duration.days ?? 0) * 86_400_000 + (duration.hours ?? 0) * 3_600_000 + (duration.minutes ?? 0) * 60_000 + (duration.milliseconds ?? 0);
    this.#now = new Date(this.#now.getTime() + milliseconds);
  }
}
