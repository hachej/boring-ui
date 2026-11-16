// The host's one piece of configuration: the spike's namespace. Every Cloudflare name starts with it (Secrets Store names use `_`).
export const SPIKE = "boring-spike-notes-p4";
export const secretPrefix = SPIKE.replaceAll("-", "_");
