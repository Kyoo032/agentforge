/**
 * Meeting delete is two steps (0.15.0 verify finding 7).
 *
 * Deleting a meeting removes its folder, recording included, so the × on a row only arms it; the
 * DELETE goes out when the owner presses the confirm button in the panel that opens.
 *
 * The environment is node with no DOM, so the row is rendered to markup for what shows, and called
 * as a plain function (it has no hooks) to press its buttons and see which callback each one reaches.
 */
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeetingListRow, type MeetingListRowProps } from "@/components/meeting-studio";
import { applyLocale, resetLocaleForTests } from "./i18n";

const MEETING = { id: "m1", title: "Checkout weekly", status: "recorded" as const };

function props(overrides: Partial<MeetingListRowProps> = {}): MeetingListRowProps {
  return {
    meeting: MEETING,
    selected: false,
    confirming: false,
    deleting: false,
    onSelect: vi.fn(),
    onAskDelete: vi.fn(),
    onConfirmDelete: vi.fn(),
    onCancelDelete: vi.fn(),
    ...overrides,
  };
}

type ButtonProps = { "data-testid"?: string; onClick?: () => void; disabled?: boolean; children?: ReactNode };

function findByTestId(node: ReactNode, testId: string): ReactElement<ButtonProps> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByTestId(child, testId);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement<ButtonProps>(node)) return null;
  if (node.props["data-testid"] === testId) return node;
  return findByTestId(node.props.children, testId);
}

function press(tree: ReactNode, testId: string) {
  const button = findByTestId(tree, testId);
  expect(button, `${testId} is not rendered`).not.toBeNull();
  button?.props.onClick?.();
}

afterEach(() => {
  resetLocaleForTests();
});

describe("meeting delete, first press", () => {
  it("shows only the × until it is pressed", () => {
    const html = renderToStaticMarkup(<MeetingListRow {...props()} />);
    expect(html).toContain('data-testid="meeting-delete-m1"');
    expect(html).not.toContain('data-testid="meeting-delete-confirm"');
    expect(html).not.toContain('data-testid="meeting-delete-cancel"');
  });

  it("arms the row and does not delete anything", () => {
    const p = props();
    press(MeetingListRow(p), "meeting-delete-m1");
    expect(p.onAskDelete).toHaveBeenCalledTimes(1);
    expect(p.onConfirmDelete).not.toHaveBeenCalled();
  });
});

describe("meeting delete, second step", () => {
  it("names the meeting and offers Delete and Cancel", () => {
    const html = renderToStaticMarkup(<MeetingListRow {...props({ confirming: true })} />);
    expect(html).toContain('data-testid="meeting-delete-panel"');
    expect(html).toContain('data-testid="meeting-delete-confirm"');
    expect(html).toContain('data-testid="meeting-delete-cancel"');
    expect(html).toContain("Checkout weekly");
    expect(html).toContain("Delete meeting");
  });

  it("deletes only on the confirm button", () => {
    const p = props({ confirming: true });
    press(MeetingListRow(p), "meeting-delete-confirm");
    expect(p.onConfirmDelete).toHaveBeenCalledTimes(1);
    expect(p.onCancelDelete).not.toHaveBeenCalled();
  });

  it("backs out on Cancel without deleting", () => {
    const p = props({ confirming: true });
    press(MeetingListRow(p), "meeting-delete-cancel");
    expect(p.onCancelDelete).toHaveBeenCalledTimes(1);
    expect(p.onConfirmDelete).not.toHaveBeenCalled();
  });

  it("locks both buttons while the delete is in flight", () => {
    const tree = MeetingListRow(props({ confirming: true, deleting: true }));
    expect(findByTestId(tree, "meeting-delete-confirm")?.props.disabled).toBe(true);
    expect(findByTestId(tree, "meeting-delete-cancel")?.props.disabled).toBe(true);
  });

  it("renders the confirm copy in Indonesian", () => {
    applyLocale("id");
    const html = renderToStaticMarkup(<MeetingListRow {...props({ confirming: true })} />);
    expect(html).toContain("Hapus rapat");
    expect(html).toContain("Hapus “Checkout weekly”?");
  });
});

/**
 * A recording belongs to the meeting that was selected when Record was pressed. Switching rows
 * mid-recording used to re-point the upload at whichever meeting was selected when it finished —
 * and the host replaced that meeting's recording with it. The list is locked while the microphone
 * is open, and the meeting being recorded cannot be deleted out from under it.
 */
describe("meeting list while a recording runs", () => {
  it("cannot be switched to another meeting, and says why", () => {
    const tree = MeetingListRow(props({ locked: true }));
    const row = findByTestId(tree, "meeting-item-m1");
    expect(row?.props.disabled).toBe(true);
    const html = renderToStaticMarkup(<MeetingListRow {...props({ locked: true })} />);
    expect(html).toContain("Stop the recording before switching meetings.");
  });

  it("stays selectable when nothing is recording", () => {
    const tree = MeetingListRow(props());
    expect(findByTestId(tree, "meeting-item-m1")?.props.disabled).toBeFalsy();
  });

  it("will not arm a delete of the meeting being recorded", () => {
    const tree = MeetingListRow(props({ deleteLocked: true }));
    expect(findByTestId(tree, "meeting-delete-m1")?.props.disabled).toBe(true);
  });

  it("explains the lock in Indonesian too", () => {
    applyLocale("id");
    const html = renderToStaticMarkup(<MeetingListRow {...props({ locked: true })} />);
    expect(html).toContain("Hentikan rekaman sebelum berpindah rapat.");
  });
});
