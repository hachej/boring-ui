/**
 * The Pi Durable release whose public exports Boring records were checked against. Records carry it so a reader can tell which
 * native shapes produced them. New records take the current release; records written under an earlier reviewed release stay
 * readable, because the native conversation and tool shapes they refer to did not change between them.
 */
export const NATIVE_VERSION = 'pi-durable@1.1.0';
export type NativeVersion = 'pi-durable@1.0.1' | typeof NATIVE_VERSION;
export const isNativeVersion = (value: unknown): value is NativeVersion => value === NATIVE_VERSION || value === 'pi-durable@1.0.1';
