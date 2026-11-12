export interface PublicModule {
  readonly subpath: string
  readonly name: string
  readonly source: string
  readonly import: string
  readonly types: string
}

export declare const publicModules: (manifest: unknown) => ReadonlyArray<PublicModule>
