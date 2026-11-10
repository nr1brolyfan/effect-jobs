// Test-only observation wrapper. Production Worker has no diagnostic HTTP routes.
import Worker, {
  Communications,
  Media,
  Commerce,
  Private,
  Gateway,
  SandboxLive,
  type Env
} from "../../src/Worker.js"
import type { LiveState } from "../../src/live/SandboxLive.js"
export { Gateway, SandboxLive }
export class CommunicationsProbe extends Communications {
  calls = 0
  activations = 0
  constructor(
    private readonly testState: LiveState,
    env: Env
  ) {
    super(testState, env)
  }
  async alarm(): Promise<void> {
    this.calls++
    await super.alarm()
  }
  async activate(): Promise<void> {
    this.activations++
    await super.activate()
  }
  async inspect(): Promise<{ calls: number; activations: number; alarm: number | null }> {
    return {
      calls: this.calls,
      activations: this.activations,
      alarm: await this.testState.storage.getAlarm()
    }
  }
}
export class MediaProbe extends Media {
  calls = 0
  activations = 0
  constructor(
    private readonly testState: LiveState,
    env: Env
  ) {
    super(testState, env)
  }
  async alarm(): Promise<void> {
    this.calls++
    await super.alarm()
  }
  async activate(): Promise<void> {
    this.activations++
    await super.activate()
  }
  async inspect(): Promise<{ calls: number; activations: number; alarm: number | null }> {
    return {
      calls: this.calls,
      activations: this.activations,
      alarm: await this.testState.storage.getAlarm()
    }
  }
}
export class CommerceProbe extends Commerce {
  calls = 0
  activations = 0
  constructor(
    private readonly testState: LiveState,
    env: Env
  ) {
    super(testState, env)
  }
  async alarm(): Promise<void> {
    this.calls++
    await super.alarm()
  }
  async activate(): Promise<void> {
    this.activations++
    await super.activate()
  }
  async inspect(): Promise<{ calls: number; activations: number; alarm: number | null }> {
    return {
      calls: this.calls,
      activations: this.activations,
      alarm: await this.testState.storage.getAlarm()
    }
  }
}
export class PrivateProbe extends Private {
  calls = 0
  activations = 0
  constructor(
    private readonly testState: LiveState,
    env: Env
  ) {
    super(testState, env)
  }
  async alarm(): Promise<void> {
    this.calls++
    await super.alarm()
  }
  async activate(): Promise<void> {
    this.activations++
    await super.activate()
  }
  async inspect(): Promise<{ calls: number; activations: number; alarm: number | null }> {
    return {
      calls: this.calls,
      activations: this.activations,
      alarm: await this.testState.storage.getAlarm()
    }
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/_integration/queues") {
      const queues = [env.COMMUNICATIONS, env.MEDIA, env.COMMERCE, env.PRIVATE]
      const result = await Promise.all(
        queues.map((namespace) =>
          (
            namespace.getByName("shared") as unknown as { inspect(): Promise<unknown> }
          ).inspect()
        )
      )
      return Response.json(result)
    }
    return Worker.fetch(request, env)
  }
}
