import type { CapabilityId, CapabilityRegistry, VoiceCapability } from "./types";

export class InMemoryCapabilityRegistry implements CapabilityRegistry {
  private readonly capabilities = new Map<CapabilityId, VoiceCapability>();

  public register(capability: VoiceCapability): void {
    if (this.capabilities.has(capability.id)) {
      throw new Error(`Duplicate capability id: ${capability.id}`);
    }

    this.capabilities.set(capability.id, capability);
  }

  public unregister(id: CapabilityId): void {
    this.capabilities.delete(id);
  }

  public get(id: CapabilityId): VoiceCapability | undefined {
    return this.capabilities.get(id);
  }

  public list(): VoiceCapability[] {
    return [...this.capabilities.values()];
  }
}

export const createCapabilityRegistry = (): CapabilityRegistry => new InMemoryCapabilityRegistry();

export type CapabilityRegistryFactory = () => CapabilityRegistry;

export const createRegistryFactory = (): CapabilityRegistryFactory => {
  return () => new InMemoryCapabilityRegistry();
};
