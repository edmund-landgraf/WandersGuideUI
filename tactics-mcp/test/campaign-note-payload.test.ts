import assert from "node:assert/strict";
import { test } from "node:test";
import { notesFromCampaign, patchNotePage } from "../../supabase/wgui-ext/_wgui-ext/campaign-notes.ts";

test("one-page patch preserves a large campaign's other pages", () => {
  const pages = Array.from({ length: 25 }, (_, i) => ({
    name: `Page ${i}`, icon: "notebook", color: "#359fdf", shared: false,
    contents: "x".repeat(7000),
  }));
  const campaign = { notes: { pages } };
  assert.ok(JSON.stringify(campaign.notes).length > 170000);
  const patch = { contents: "updated" };
  assert.ok(JSON.stringify({ campaign_id: 41, page_index: 12, expected_page_name: "Page 12", patch }).length < 1024);
  const next = patchNotePage(notesFromCampaign(campaign).pages, 12, patch, true);
  assert.equal(next[12].contents, "updated");
  assert.equal(next[12].name, "Page 12");
  assert.deepEqual(next.filter((_, i) => i !== 12), pages.filter((_, i) => i !== 12));
  assert.equal(pages[12].contents.length, 7000);
});
