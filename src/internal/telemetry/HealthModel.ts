export interface HealthBucket {
  readonly count: number
  readonly saturated: boolean
  readonly oldestAt: number | null
}
export interface HealthSample {
  readonly sampledAt: number
  readonly supported: HealthBucket
  readonly unsupported: HealthBucket
  readonly expired: HealthBucket
  readonly cleanup: HealthBucket
}
