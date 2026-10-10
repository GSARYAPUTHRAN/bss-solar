import { describe, it, expect, afterEach, vi } from "vitest";
import { COMPANY } from "@/lib/constants";
import { isPushConfigured, pushConfig } from "./config";

function env(vars: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...vars };
}

const KEYS = {
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: "public-key",
  VAPID_PRIVATE_KEY: "private-key",
};

afterEach(() => vi.unstubAllEnvs());

describe("pushConfig", () => {
  it("is null with no VAPID keys — push is optional", () => {
    expect(pushConfig(env({}))).toBeNull();
  });

  it("is null when either key is missing", () => {
    expect(pushConfig(env({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "public-key" }))).toBeNull();
    expect(pushConfig(env({ VAPID_PRIVATE_KEY: "private-key" }))).toBeNull();
  });

  it("is null when a key is blank or whitespace", () => {
    expect(pushConfig(env({ ...KEYS, VAPID_PRIVATE_KEY: "" }))).toBeNull();
    expect(pushConfig(env({ ...KEYS, NEXT_PUBLIC_VAPID_PUBLIC_KEY: "  \n" }))).toBeNull();
  });

  it("defaults the subject to the company mailbox", () => {
    expect(pushConfig(env(KEYS))).toEqual({
      publicKey: "public-key",
      privateKey: "private-key",
      subject: `mailto:${COMPANY.email}`,
    });
  });

  it("falls back to the default subject when VAPID_SUBJECT is blank", () => {
    expect(pushConfig(env({ ...KEYS, VAPID_SUBJECT: "   " }))?.subject).toBe(
      `mailto:${COMPANY.email}`,
    );
  });

  it("uses VAPID_SUBJECT when set", () => {
    expect(pushConfig(env({ ...KEYS, VAPID_SUBJECT: "https://bss.example" }))?.subject).toBe(
      "https://bss.example",
    );
  });

  // any non-blank VAPID_SUBJECT is accepted, but web-push
  // throws "Vapid subject is not a valid URL" for a bare address such as
  // "ops@bss.example". isPushConfigured() then reports push as working while
  // every send fails (logged as a "network" failure per device). Fix: in
  // pushConfig, prefix a bare e-mail with "mailto:" and fall back to the
  // default subject (with a warning) for anything that is not an https:/mailto:
  // URL.
  it("only yields a subject web-push accepts", () => {
    for (const subject of ["ops@bss.example", "bss.example", "http://bss.example"]) {
      const config = pushConfig(env({ ...KEYS, VAPID_SUBJECT: subject }));
      expect(config).not.toBeNull();
      expect(["mailto:", "https:"]).toContain(new URL(config!.subject).protocol);
    }
  });

  it("trims stray whitespace from pasted values", () => {
    expect(
      pushConfig(
        env({
          NEXT_PUBLIC_VAPID_PUBLIC_KEY: "  public-key\n",
          VAPID_PRIVATE_KEY: "\tprivate-key  ",
          VAPID_SUBJECT: " mailto:ops@bss.example ",
        }),
      ),
    ).toEqual({
      publicKey: "public-key",
      privateKey: "private-key",
      subject: "mailto:ops@bss.example",
    });
  });

  it("reads process.env by default", () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "env-public");
    vi.stubEnv("VAPID_PRIVATE_KEY", "env-private");
    vi.stubEnv("VAPID_SUBJECT", "");
    expect(pushConfig()).toEqual({
      publicKey: "env-public",
      privateKey: "env-private",
      subject: `mailto:${COMPANY.email}`,
    });
  });
});

describe("isPushConfigured", () => {
  it("mirrors pushConfig", () => {
    expect(isPushConfigured(env({}))).toBe(false);
    expect(isPushConfigured(env({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "public-key" }))).toBe(false);
    expect(isPushConfigured(env(KEYS))).toBe(true);
  });

  it("reads process.env by default", () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect(isPushConfigured()).toBe(false);
  });
});
