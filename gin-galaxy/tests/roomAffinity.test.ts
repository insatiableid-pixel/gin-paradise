import { describe, expect, it } from "vitest";
import { buildRoomHandoffHint, canServeRoomLocally } from "../server/multiplayer/roomAffinity.js";

describe("roomAffinity", () => {
  it("allows rooms owned by the current node", () => {
    expect(canServeRoomLocally({ id: "R1", ownerNodeId: "node-a" }, "node-a")).toBe(true);
  });

  it("allows legacy rooms without ownership metadata", () => {
    expect(canServeRoomLocally({ id: "R1" }, "node-a")).toBe(true);
  });

  it("allows rooms whose ownership lease has expired", () => {
    expect(
      canServeRoomLocally(
        { id: "R1", ownerNodeId: "node-a", ownerLeaseExpiresAt: Date.now() - 1_000 },
        "node-b"
      )
    ).toBe(true);
  });

  it("keeps active ownership on the serving node only", () => {
    expect(
      canServeRoomLocally(
        { id: "R1", ownerNodeId: "node-a", ownerLeaseExpiresAt: Date.now() + 10_000 },
        "node-b"
      )
    ).toBe(false);
  });

  it("builds a structured handoff hint for wrong-node access", () => {
    const hint = buildRoomHandoffHint({ id: "R1", ownerNodeId: "node-a" }, "node-b", "join_room");

    expect(hint).toMatchObject({
      roomId: "R1",
      ownerNodeId: "node-a",
      currentNodeId: "node-b",
      action: "join_room",
    });
    expect(hint.message).toContain("node-a");
    expect(hint.message).toContain("relay/failover recovery");
    expect(hint.message).not.toContain("sticky session");
  });
});
