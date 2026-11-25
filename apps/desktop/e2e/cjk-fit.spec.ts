import { expect, test, type Locator, type Page } from "@playwright/test";
import { avatarTextOk } from "../test/support/markup";
import {
  bridgePort,
  clientUrl,
  dataDir,
  serverUrl,
  type BridgeSpec,
} from "./env";
import { startBridgeProc, type Proc } from "./procs";

/*
 * CJK names fit where they are shown, in a real browser (layout, not markup): avatars keep one
 * line inside their circle, and member names in the top bar, the sidebar, the Members page, the
 * handoff modal's people list and the dashboard's members card do not spill out of their boxes.
 * Alex (dev-alex) in zh-CN on the sample paper project. The e2e server's dev users give the sample
 * people Latin names, so two members with CJK names join through invites first: a short one and
 * a long one. Bridge slot 9: this file sorts first and stops its bridge in afterAll.
 */
const CJK_NAMES = ["张老师", "欧阳娜娜与司马相如的研究助理"];
const A: BridgeSpec = {
  name: "cjk-fit",
  port: bridgePort(9),
  token: "e2e-cjk-fit",
  locale: "zh-CN",
};
const PAPER = "sample-paper";

test.describe.configure({ mode: "serial" });

let proc: Proc | null = null;
let page: Page;

async function joinWithInvite(displayName: string): Promise<void> {
  const inv = await fetch(`${serverUrl}/v1/projects/${PAPER}/invites`, {
    method: "POST",
    headers: {
      authorization: "Bearer dev-alex",
      "content-type": "application/json",
    },
    body: JSON.stringify({ roleId: null }),
  });
  expect(inv.ok, `invite: HTTP ${inv.status}`).toBe(true);
  const { code } = (await inv.json()) as { code: string };
  const r = await fetch(`${serverUrl}/v1/invites/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, displayName, locale: "zh-CN" }),
  });
  expect(r.ok, `redeem: HTTP ${r.status}`).toBe(true);
}

test.beforeAll(async ({ browser }) => {
  for (const n of CJK_NAMES) await joinWithInvite(n);
  proc = await startBridgeProc({
    dataDir: dataDir(A),
    port: A.port,
    locale: A.locale,
    token: A.token,
  });
  page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  await page.goto(clientUrl(A));
  await page.getByTestId("signin-server").fill(serverUrl);
  await page.getByTestId("signin-token").fill("dev-alex");
  await page.getByTestId("signin-submit").click();
  await expect(page.getByTestId("sync-status")).toHaveAttribute(
    "data-state",
    "online",
  );
});
test.afterAll(async () => {
  await page?.context().close();
  await proc?.stop();
});

interface Misfit {
  what: string;
  text: string;
}

/**
 * Avatars whose text is not one glyph (or two Latin letters) on one line, and texts that spill out
 * of their box, under `scope`. With `oneLine`, also member names and short labels that wrap.
 */
async function misfits(scope: Locator, oneLine = false): Promise<Misfit[]> {
  const raw = await scope.evaluateAll(
    (roots, { oneLine, names }) => {
      const out: { what: string; text: string; avatar: boolean }[] = [];
      for (const root of roots)
        for (const el of [
          root,
          ...root.querySelectorAll("*"),
        ] as HTMLElement[]) {
          const own = [...el.childNodes].some(
            (n) =>
              n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== "",
          );
          if (!own || el.offsetParent === null) continue;
          const text = el.textContent!.trim();
          if (el.classList.contains("av")) {
            // Line boxes of the text itself: a wrapped name has rects at more than one top.
            const range = document.createRange();
            range.selectNodeContents(el);
            const lines = new Set(
              [...range.getClientRects()].map((r) => Math.round(r.top)),
            ).size;
            if (el.scrollWidth > el.clientWidth + 1 || lines > 1)
              out.push({ what: "avatar overflows", text, avatar: true });
            else out.push({ what: "avatar", text, avatar: true });
          } else if (
            el.scrollWidth > el.clientWidth + 1 &&
            getComputedStyle(el).textOverflow !== "ellipsis" &&
            getComputedStyle(el).overflowX === "visible"
          ) {
            out.push({
              what: `${el.tagName.toLowerCase()}.${el.className} spills`,
              text,
              avatar: false,
            });
          } else if (oneLine) {
            // A member name, or a short label (a role, "负责 0 项"), broken over two lines: its own
            // text nodes have line boxes more than half a line apart (child elements are measured on
            // their own, so a smaller "你" tag or a × button next to the text does not count).
            const rects = [...el.childNodes]
              .filter(
                (n) =>
                  n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== "",
              )
              .flatMap((n) => {
                const r = document.createRange();
                r.selectNodeContents(n);
                return [...r.getClientRects()];
              });
            const lines =
              rects.length === 0
                ? 0
                : 1 +
                  rects.filter(
                    (r) => r.top - rects[0]!.top > rects[0]!.height / 2,
                  ).length;
            if (lines > 1 && ([...text].length <= 8 || names.includes(text)))
              out.push({
                what: `${el.tagName.toLowerCase()}.${el.className} wraps`,
                text,
                avatar: false,
              });
          }
        }
      return out;
    },
    { oneLine, names: CJK_NAMES },
  );
  return raw
    .filter((m) => m.what !== "avatar" || !m.avatar)
    .concat(
      raw
        .filter((m) => m.what === "avatar")
        .filter((m) => !avatarTextOk(m.text))
        .map((m) => ({ ...m, what: "avatar text" })),
    )
    .map(({ what, text }) => ({ what, text }));
}

async function openPaper(): Promise<void> {
  await page
    .locator(`[data-testid="nav-project"][data-project="${PAPER}"]`)
    .click();
  await expect(page.getByTestId("page-dash")).toBeVisible();
}

test("avatars and member names fit in the shell, dashboard, members page and handoff modal", async () => {
  await openPaper();
  const avatars = page.locator(".av");
  expect(await avatars.count()).toBeGreaterThan(3);
  for (const n of CJK_NAMES)
    await expect(page.locator(`.av[title="${n}"]`).first(), n).toHaveText(
      n[0]!,
    );

  expect(
    await misfits(
      page.locator(
        '.topbar, .sidebar, [data-testid="topbar"], [data-testid="sidebar"]',
      ),
    ),
    "shell",
  ).toEqual([]);
  expect(
    await misfits(page.locator('[data-card="members"]'), true),
    "members card",
  ).toEqual([]);
  expect(
    await misfits(page.getByTestId("page-dash")),
    "project dashboard",
  ).toEqual([]);

  await page.getByTestId("nav-members").click();
  await expect(page.getByTestId("page-members")).toBeVisible();
  expect(
    await misfits(page.getByTestId("member"), true),
    "members page rows",
  ).toEqual([]);

  await openPaper();
  await page.getByTestId("nav-board").click();
  await expect(page.getByTestId("page-board")).toBeVisible();
  await page.locator('[data-testid="need-card"]:not(.priv)').first().click();
  await page.getByTestId("drawer").getByTestId("dr-handoff").click();
  const modal = page.getByTestId("overlay-handoff");
  await expect(modal).toBeVisible();
  expect(await modal.getByTestId("ho-person").count()).toBeGreaterThan(1);
  expect(
    await misfits(modal.getByTestId("ho-person"), true),
    "handoff people list",
  ).toEqual([]);
  expect(await misfits(page.getByTestId("drawer")), "need drawer").toEqual([]);
  await page.keyboard.press("Escape");
});
