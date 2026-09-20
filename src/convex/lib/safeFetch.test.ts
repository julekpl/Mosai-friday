import { describe, expect, it } from "vitest";
import { isPublicIpAddress } from "./safeFetch";

describe("isPublicIpAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.2",
    "169.254.169.254",
    "100.64.1.1",
    "192.0.2.4",
    "198.51.100.8",
    "203.0.113.9",
    "::1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
  ])("blocks %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "allows %s",
    (address) => expect(isPublicIpAddress(address)).toBe(true),
  );
});
