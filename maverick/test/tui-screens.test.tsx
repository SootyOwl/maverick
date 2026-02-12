import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";
import { TextInput } from "../src/tui/components/TextInput.js";
import { StatusBar } from "../src/tui/components/StatusBar.js";

// ─── TextInput ───────────────────────────────────────────────────────────

describe("TextInput", () => {
  it("renders label and value", () => {
    const { lastFrame } = render(
      <TextInput
        label="Handle"
        value="alice.bsky.social"
        onChange={() => {}}
        active={false}
      />,
    );
    const output = lastFrame();
    expect(output).toContain("Handle:");
    expect(output).toContain("alice.bsky.social");
  });

  it("shows cursor when active", () => {
    const { lastFrame } = render(
      <TextInput
        label="Name"
        value="test"
        onChange={() => {}}
        active={true}
      />,
    );
    const output = lastFrame();
    expect(output).toContain("test");
    expect(output).toContain("▊");
  });

  it("shows placeholder when empty and inactive", () => {
    const { lastFrame } = render(
      <TextInput
        label="Handle"
        value=""
        onChange={() => {}}
        active={false}
        placeholder="alice.bsky.social"
      />,
    );
    expect(lastFrame()).toContain("alice.bsky.social");
  });

  it("hides value in secret mode", () => {
    const { lastFrame } = render(
      <TextInput
        label="Password"
        value="secret123"
        onChange={() => {}}
        active={false}
        secret
      />,
    );
    const output = lastFrame();
    expect(output).toContain("*********");
    expect(output).not.toContain("secret123");
  });

  it("shows cursor with masked text in secret+active mode", () => {
    const { lastFrame } = render(
      <TextInput
        label="Password"
        value="abc"
        onChange={() => {}}
        active={true}
        secret
      />,
    );
    const output = lastFrame();
    expect(output).toContain("***");
    expect(output).toContain("▊");
    expect(output).not.toContain("abc");
  });
});

// ─── StatusBar with customHints ──────────────────────────────────────────

describe("StatusBar customHints", () => {
  it("renders default hints when customHints not provided", () => {
    const { lastFrame } = render(
      <StatusBar
        communityName="Test"
        handle="alice"
        mode="normal"
        panel="messages"
        error={null}
      />,
    );
    const output = lastFrame();
    expect(output).toContain("q:quit");
    expect(output).toContain("r:reply");
  });

  it("renders customHints when provided", () => {
    const { lastFrame } = render(
      <StatusBar
        communityName="Test"
        handle="alice"
        mode="normal"
        panel="messages"
        error={null}
        customHints="j/k:nav N:new-channel q:back"
      />,
    );
    const output = lastFrame();
    expect(output).toContain("N:new-channel");
    expect(output).toContain("q:back");
  });

  it("ignores customHints in insert mode", () => {
    const { lastFrame } = render(
      <StatusBar
        communityName="Test"
        handle="alice"
        mode="insert"
        panel="messages"
        error={null}
        customHints="custom hints here"
      />,
    );
    const output = lastFrame();
    expect(output).toContain("Enter");
    expect(output).toContain("send");
    expect(output).toContain("Esc");
    expect(output).toContain("cancel");
    expect(output).not.toContain("custom hints here");
  });
});

// ─── LoginScreen ─────────────────────────────────────────────────────────

describe("LoginScreen", () => {
  it("renders login form with empty credentials", async () => {
    const { LoginScreen } = await import("../src/tui/screens/LoginScreen.js");
    const config = {
      bluesky: { handle: "", password: "", pdsUrl: "https://bsky.social" },
      xmtp: { env: "dev" as const, dbPath: "/tmp/xmtp.db3" },
      dataDir: "/tmp/.maverick",
      sqlitePath: "/tmp/maverick.db",
    };

    const { lastFrame } = render(
      <LoginScreen initialConfig={config} onLogin={() => {}} />,
    );
    const output = lastFrame();
    expect(output).toContain("maverick");
    expect(output).toContain("private community chat");
    expect(output).toContain("Handle:");
    expect(output).toContain("Password:");
    expect(output).toContain("Tab");
    expect(output).toContain(":switch");
  });

  it("pre-fills handle from config", async () => {
    const { LoginScreen } = await import("../src/tui/screens/LoginScreen.js");
    const config = {
      bluesky: { handle: "bob.bsky.social", password: "", pdsUrl: "https://bsky.social" },
      xmtp: { env: "dev" as const, dbPath: "/tmp/xmtp.db3" },
      dataDir: "/tmp/.maverick",
      sqlitePath: "/tmp/maverick.db",
    };

    const { lastFrame } = render(
      <LoginScreen initialConfig={config} onLogin={() => {}} />,
    );
    expect(lastFrame()).toContain("bob.bsky.social");
  });
});

// ─── CommunityListScreen ─────────────────────────────────────────────────

describe("CommunityListScreen", () => {
  it("shows scanning message on initial load", async () => {
    const { CommunityListScreen } = await import(
      "../src/tui/screens/CommunityListScreen.js"
    );

    const mockSession = {
      xmtpClient: {} as any,
      db: { close: vi.fn() } as any,
      handle: "alice.bsky.social",
      did: "did:plc:abc",
      agent: {} as any,
      privateKey: "0x123" as `0x${string}`,
      manager: {
        listCommunities: vi.fn().mockImplementation(
          () => new Promise(() => {}), // never resolves — keeps loading
        ),
      } as any,
    };

    const { lastFrame } = render(
      <CommunityListScreen session={mockSession} onNavigate={() => {}} />,
    );
    expect(lastFrame()).toContain("Scanning for communities");
  });

  it("shows empty state when no communities found", async () => {
    const { CommunityListScreen } = await import(
      "../src/tui/screens/CommunityListScreen.js"
    );

    const mockSession = {
      xmtpClient: {} as any,
      db: { close: vi.fn() } as any,
      handle: "alice.bsky.social",
      did: "did:plc:abc",
      agent: {} as any,
      privateKey: "0x123" as `0x${string}`,
      manager: {
        listCommunities: vi.fn().mockResolvedValue([]),
      } as any,
    };

    const { lastFrame } = render(
      <CommunityListScreen session={mockSession} onNavigate={() => {}} />,
    );

    // Wait for async update
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("No communities yet");
    });
  });

  it("lists communities after loading", async () => {
    const { CommunityListScreen } = await import(
      "../src/tui/screens/CommunityListScreen.js"
    );

    const mockSession = {
      xmtpClient: {} as any,
      db: { close: vi.fn() } as any,
      handle: "alice.bsky.social",
      did: "did:plc:abc",
      agent: {} as any,
      privateKey: "0x123" as `0x${string}`,
      manager: {
        listCommunities: vi.fn().mockResolvedValue([
          { groupId: "g1", name: "Alpha Community" },
          { groupId: "g2", name: "Beta Community" },
        ]),
      } as any,
    };

    const { lastFrame } = render(
      <CommunityListScreen session={mockSession} onNavigate={() => {}} />,
    );

    await vi.waitFor(() => {
      const output = lastFrame();
      expect(output).toContain("Alpha Community");
      expect(output).toContain("Beta Community");
    });
  });

  it("shows handle in header", async () => {
    const { CommunityListScreen } = await import(
      "../src/tui/screens/CommunityListScreen.js"
    );

    const mockSession = {
      xmtpClient: {} as any,
      db: { close: vi.fn() } as any,
      handle: "alice.bsky.social",
      did: "did:plc:abc",
      agent: {} as any,
      privateKey: "0x123" as `0x${string}`,
      manager: {
        listCommunities: vi.fn().mockResolvedValue([]),
      } as any,
    };

    const { lastFrame } = render(
      <CommunityListScreen session={mockSession} onNavigate={() => {}} />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("alice.bsky.social");
    });
  });

  it("shows keyboard hints", async () => {
    const { CommunityListScreen } = await import(
      "../src/tui/screens/CommunityListScreen.js"
    );

    const mockSession = {
      xmtpClient: {} as any,
      db: { close: vi.fn() } as any,
      handle: "alice.bsky.social",
      did: "did:plc:abc",
      agent: {} as any,
      privateKey: "0x123" as `0x${string}`,
      manager: {
        listCommunities: vi.fn().mockResolvedValue([]),
      } as any,
    };

    const { lastFrame } = render(
      <CommunityListScreen session={mockSession} onNavigate={() => {}} />,
    );

    await vi.waitFor(() => {
      const output = lastFrame();
      expect(output).toContain("n:new");
      expect(output).toContain("J:join");
      expect(output).toContain("q:quit");
    });
  });
});

// ─── CommunityCreateScreen ───────────────────────────────────────────────

describe("CommunityCreateScreen", () => {
  it("renders create form", async () => {
    const { CommunityCreateScreen } = await import(
      "../src/tui/screens/CommunityCreateScreen.js"
    );

    const mockSession = {
      xmtpClient: {} as any,
      db: {} as any,
      handle: "alice.bsky.social",
      did: "did:plc:abc",
      agent: {} as any,
      privateKey: "0x123" as `0x${string}`,
      manager: { createCommunity: vi.fn(), createChannel: vi.fn() } as any,
    };

    const { lastFrame } = render(
      <CommunityCreateScreen
        session={mockSession}
        onNavigate={() => {}}
        onBack={() => {}}
      />,
    );
    const output = lastFrame();
    expect(output).toContain("Create Community");
    expect(output).toContain("Name:");
    expect(output).toContain("Description:");
    expect(output).toContain("Enter:create");
    expect(output).toContain("Esc:back");
  });
});

// ─── JoinScreen ──────────────────────────────────────────────────────────

describe("JoinScreen", () => {
  it("renders join form", async () => {
    const { JoinScreen } = await import("../src/tui/screens/JoinScreen.js");

    const mockSession = {
      xmtpClient: { inboxId: "inbox-123" } as any,
      db: {} as any,
      handle: "alice.bsky.social",
      did: "did:plc:abc",
      agent: {} as any,
      privateKey: "0x123" as `0x${string}`,
      manager: {} as any,
    };

    const { lastFrame } = render(
      <JoinScreen session={mockSession} onBack={() => {}} />,
    );
    const output = lastFrame();
    expect(output).toContain("Join Community");
    expect(output).toContain("Invite token:");
    expect(output).toContain("Enter:verify");
    expect(output).toContain("Esc:back");
  });
});

// ─── ChannelCreateScreen ─────────────────────────────────────────────────

describe("ChannelCreateScreen", () => {
  it("renders channel create form with community name", async () => {
    const { ChannelCreateScreen } = await import(
      "../src/tui/screens/ChannelCreateScreen.js"
    );

    const mockSession = {
      xmtpClient: {} as any,
      db: {} as any,
      handle: "alice.bsky.social",
      did: "did:plc:abc",
      agent: {} as any,
      privateKey: "0x123" as `0x${string}`,
      manager: { createChannel: vi.fn() } as any,
    };

    const { lastFrame } = render(
      <ChannelCreateScreen
        session={mockSession}
        metaGroupId="meta-123"
        communityName="Test Community"
        onBack={() => {}}
      />,
    );
    const output = lastFrame();
    expect(output).toContain("New Channel");
    expect(output).toContain("Test Community");
    expect(output).toContain("Name:");
    expect(output).toContain("Description:");
    expect(output).toContain("Enter:create");
  });
});

// ─── AddMemberScreen ─────────────────────────────────────────────────────

describe("AddMemberScreen", () => {
  it("renders invite & add member form", async () => {
    const { AddMemberScreen } = await import("../src/tui/screens/AddMemberScreen.js");

    const mockSession = {
      xmtpClient: {} as any,
      db: {} as any,
      handle: "alice.bsky.social",
      did: "did:plc:abc",
      agent: {} as any,
      privateKey: "0x123" as `0x${string}`,
      manager: { addMember: vi.fn() } as any,
    };

    const { lastFrame } = render(
      <AddMemberScreen
        session={mockSession}
        metaGroupId="meta-123"
        communityName="Test Community"
        onBack={() => {}}
      />,
    );
    const output = lastFrame();
    expect(output).toContain("Invite & Add Member");
    expect(output).toContain("Test Community");
    expect(output).toContain("Handle or Inbox ID:");
    expect(output).toContain("Enter:add");
    expect(output).toContain("Esc:back");
  });
});

// ─── useAppState ─────────────────────────────────────────────────────────

describe("useAppState", () => {
  it("can be imported and types are correct", async () => {
    const mod = await import("../src/tui/hooks/useAppState.js");
    expect(mod.useAppState).toBeDefined();
    expect(typeof mod.useAppState).toBe("function");
  });
});
