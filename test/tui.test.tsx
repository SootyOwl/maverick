import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Text, Box } from "ink";
import { Message } from "../src/tui/components/Message.js";
import { ChannelList } from "../src/tui/components/ChannelList.js";
import { StatusBar } from "../src/tui/components/StatusBar.js";
import { Composer } from "../src/tui/components/Composer.js";
import { ReplySelector } from "../src/tui/components/ReplySelector.js";
import { MessageView } from "../src/tui/components/MessageView.js";
import { ThreadLines } from "../src/tui/components/ThreadLines.js";
import { ProfileCard } from "../src/tui/components/ProfileCard.js";
import type { VisibleMessage } from "../src/messaging/dag.js";
import type { ChannelState } from "../src/community/state.js";

const sampleMessage: VisibleMessage = {
  id: "msg-1",
  channelId: "ch-1",
  senderInboxId: "inbox-abc123def456",
  senderDid: null,
  senderHandle: "alice.bsky.social",
  text: "Hello world!",
  createdAt: Date.now(),
  parentIds: [],
  edited: false,
};

const sampleChannel: ChannelState = {
  channelId: "ch-1",
  name: "general",
  xmtpGroupId: "xg-1",
  permissions: "open",
  archived: false,
};

describe("TUI components", () => {
  it("renders Message component", () => {
    const { lastFrame } = render(
      <Message message={sampleMessage} selected={false} />,
    );
    const output = lastFrame();
    expect(output).toContain("alice.bsky.social");
    expect(output).toContain("Hello world!");
  });

  it("renders selected Message with indicator", () => {
    const { lastFrame } = render(
      <Message message={sampleMessage} selected={true} />,
    );
    const output = lastFrame();
    expect(output).toContain("▎");
    expect(output).toContain("Hello world!");
  });

  it("renders Message with reply parents", () => {
    const replyMsg: VisibleMessage = {
      ...sampleMessage,
      parentIds: ["parent-abc123"],
    };
    const { lastFrame } = render(
      <Message message={replyMsg} selected={false} />,
    );
    const output = lastFrame();
    expect(output).toContain("reply to");
    expect(output).toContain("parent-a");
  });

  it("renders edited Message", () => {
    const editedMsg: VisibleMessage = {
      ...sampleMessage,
      edited: true,
    };
    const { lastFrame } = render(
      <Message message={editedMsg} selected={false} />,
    );
    expect(lastFrame()).toContain("(edited)");
  });

  it("renders ChannelList with channels", () => {
    const channels: ChannelState[] = [
      sampleChannel,
      { ...sampleChannel, channelId: "ch-2", name: "dev" },
    ];
    const { lastFrame } = render(
      <ChannelList
        channels={channels}
        currentChannelId="ch-1"
        onSelect={() => {}}
        focused={false}
        communityName="Test Community"
      />,
    );
    const output = lastFrame();
    expect(output).toContain("#general");
    expect(output).toContain("#dev");
    expect(output).toContain("Test Community");
  });

  it("renders ChannelList empty state", () => {
    const { lastFrame } = render(
      <ChannelList
        channels={[]}
        currentChannelId={null}
        onSelect={() => {}}
        focused={false}
        communityName="Empty"
      />,
    );
    expect(lastFrame()).toContain("No channels");
  });

  it("renders StatusBar", () => {
    const { lastFrame } = render(
      <StatusBar
        communityName="Test Community"
        handle="alice.bsky.social"
        mode="normal"
        panel="messages"
        error={null}
      />,
    );
    const output = lastFrame();
    expect(output).toContain("NORMAL");
    expect(output).toContain("alice.bsky.social");
    expect(output).toContain("Test Community");
  });

  it("renders StatusBar with keybinding hints", () => {
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
    expect(output).toContain("j/k");
    expect(output).toContain("r");
    expect(output).toContain("reply");
    expect(output).toContain("q");
    expect(output).toContain("quit");
  });

  it("renders StatusBar in insert mode", () => {
    const { lastFrame } = render(
      <StatusBar
        communityName="Test"
        handle="alice"
        mode="insert"
        panel="messages"
        error={null}
      />,
    );
    const output = lastFrame();
    expect(output).toContain("INSERT");
    expect(output).toContain("Enter:send");
    expect(output).toContain("Esc:cancel");
  });

  it("renders StatusBar with error", () => {
    const { lastFrame } = render(
      <StatusBar
        communityName="Test"
        handle="alice"
        mode="normal"
        panel="messages"
        error="Connection failed"
      />,
    );
    expect(lastFrame()).toContain("Connection failed");
  });

  it("renders Composer inactive", () => {
    const { lastFrame } = render(
      <Composer
        active={false}
        channelName="general"
        replyToIds={[]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    const output = lastFrame();
    expect(output).toContain("#general");
    expect(output).toContain("Press i to compose");
  });

  it("renders ReplySelector with targets", () => {
    const { lastFrame } = render(
      <ReplySelector
        replyTargets={[sampleMessage]}
        onClear={() => {}}
      />,
    );
    const output = lastFrame();
    expect(output).toContain("Replying to");
    expect(output).toContain("Hello world!");
  });

  it("renders ReplySelector empty (returns null)", () => {
    const { lastFrame } = render(
      <Box>
        <ReplySelector replyTargets={[]} onClear={() => {}} />
        <Text>after</Text>
      </Box>,
    );
    // Should just show "after", no reply selector content
    const output = lastFrame();
    expect(output).toContain("after");
    expect(output).not.toContain("Replying to");
  });

  it("renders MessageView with messages", () => {
    const { lastFrame } = render(
      <MessageView
        messages={[sampleMessage]}
        selectedIndex={0}
        channelName="general"
        focused={true}
        loading={false}
      />,
    );
    const output = lastFrame();
    expect(output).toContain("#general");
    expect(output).toContain("Hello world!");
  });

  it("renders MessageView empty state", () => {
    const { lastFrame } = render(
      <MessageView
        messages={[]}
        selectedIndex={-1}
        channelName="general"
        focused={false}
        loading={false}
      />,
    );
    expect(lastFrame()).toContain("This is the beginning of");
  });

  it("renders MessageView loading state", () => {
    const { lastFrame } = render(
      <MessageView
        messages={[]}
        selectedIndex={-1}
        channelName="general"
        focused={false}
        loading={true}
      />,
    );
    expect(lastFrame()).toContain("syncing");
  });

  it("renders ThreadLines with no thread", () => {
    const { lastFrame } = render(
      <ThreadLines thread={null} focused={false} />,
    );
    const output = lastFrame();
    expect(output).toContain("Thread");
    expect(output).toContain("Select a message");
  });

  it("renders ThreadLines with thread context", () => {
    const thread = {
      ancestors: [],
      message: {
        id: "msg-1",
        channel_id: "ch-1",
        sender_inbox_id: "inbox-abc",
        sender_did: null,
        sender_handle: "alice",
        text: "Main message",
        edit_of: null,
        delete_of: null,
        created_at: Date.now(),
        raw_content: null,
      },
      descendants: [],
    };
    const { lastFrame } = render(
      <ThreadLines thread={thread} focused={true} />,
    );
    const output = lastFrame();
    expect(output).toContain("alice");
  });

  it("renders ThreadLines with sibling parent", () => {
    const mkMsg = (id: string, handle: string, ts: number) => ({
      id,
      channel_id: "ch-1",
      sender_inbox_id: `inbox-${handle}`,
      sender_did: null,
      sender_handle: handle,
      text: `Message from ${handle}`,
      edit_of: null,
      delete_of: null,
      created_at: ts,
      raw_content: null,
    });

    const msgA = mkMsg("A", "alice", 1000);
    const msgB = mkMsg("B", "bob", 2000);
    const msgC = mkMsg("C", "carol", 3000);

    const parentMap = new Map<string, string[]>();
    parentMap.set("C", ["A", "B"]);

    const siblingParentIds = new Set(["B"]);

    const thread = {
      ancestors: [],
      message: msgA,
      descendants: [msgB, msgC],
      parentMap,
    };

    const flatMessages = [msgA, msgB, msgC];

    const { lastFrame } = render(
      <ThreadLines
        thread={thread}
        focused={true}
        flatMessages={flatMessages}
        selectedIndex={0}
        parentMap={parentMap}
        siblingParentIds={siblingParentIds}
      />,
    );
    const output = lastFrame();
    // All three senders should be visible
    expect(output).toContain("alice");
    expect(output).toContain("bob");
    expect(output).toContain("carol");
    // Separator should appear (may word-wrap in narrow panel)
    expect(output).toContain("also in");
  });

  it("renders ProfileCard", () => {
    const { lastFrame } = render(
      <ProfileCard
        handle="alice.bsky.social"
        did="did:plc:abc123def456"
        inboxId="inbox-xyz789"
      />,
    );
    const output = lastFrame();
    expect(output).toContain("alice.bsky.social");
    expect(output).toContain("DID");
    expect(output).toContain("Inbox");
  });
});
