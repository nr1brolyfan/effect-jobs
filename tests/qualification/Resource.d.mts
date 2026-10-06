export interface QualificationResource {
  readonly container_id: string
  readonly deadline: string
  readonly image: string
  readonly labels: Readonly<Record<string, string>>
  readonly ports: {
    readonly "5432/tcp": readonly [{ readonly HostIp: string; readonly HostPort: string }]
  }
}
export declare const readQualificationResource: (
  directory: string
) => QualificationResource
