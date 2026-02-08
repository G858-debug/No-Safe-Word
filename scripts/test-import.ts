/**
 * No Safe Word — Story Import Pipeline E2E Test
 *
 * Tests the complete import → verify → cleanup flow against a running local server.
 *
 * Prerequisites:
 *   1. Local Next.js dev server running:  npm run dev
 *   2. Supabase project running (local or cloud) with schema applied
 *
 * Run:
 *   npx tsx scripts/test-import.ts
 *
 * What it does:
 *   1. POSTs a minimal 2-part test story to /api/stories/import
 *   2. GETs the created series from /api/stories/{series_id}
 *   3. Validates series, posts, characters, and image prompts
 *   4. Archives (soft-deletes) the test series to clean up
 *   5. Prints a pass/fail summary
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// ─── Test Payload ──────────────────────────────────────────────

const TEST_PAYLOAD = {
  series: {
    title: "TEST STORY - DELETE ME",
    description: "Automated test series for pipeline validation. Safe to delete.",
    hashtag: "#TestStoryDeleteMe",
    total_parts: 2,
  },

  characters: [
    {
      name: "TEST_CHAR_Elena",
      role: "protagonist" as const,
      prose_description:
        "Elena is a confident woman in her late twenties with dark curly hair and warm brown eyes.",
      structured: {
        gender: "female",
        age: "28",
        ethnicity: "Latina",
        bodyType: "athletic",
        hairColor: "dark brown",
        hairStyle: "long curly",
        eyeColor: "brown",
        skinTone: "warm olive",
        distinguishingFeatures: "small scar on left eyebrow",
        clothing: "fitted black dress",
        expression: "confident smirk",
        pose: "standing with arms crossed",
      },
    },
    {
      name: "TEST_CHAR_Marcus",
      role: "love_interest" as const,
      prose_description:
        "Marcus is a tall, broad-shouldered man in his early thirties with close-cropped hair and striking green eyes.",
      structured: {
        gender: "male",
        age: "32",
        ethnicity: "African American",
        bodyType: "muscular",
        hairColor: "black",
        hairStyle: "close-cropped fade",
        eyeColor: "green",
        skinTone: "deep brown",
        distinguishingFeatures: "neatly trimmed beard",
        clothing: "white button-down shirt, sleeves rolled up",
        expression: "warm smile",
        pose: "leaning against a doorframe",
      },
    },
  ],

  posts: [
    {
      part_number: 1,
      title: "Test Story Part 1: The Meeting",
      facebook_content:
        "Elena never expected to find herself at the old bookshop on Maple Street. But when Marcus walked in, everything changed.\n\nRead the full story on our website!",
      website_content:
        "Elena never expected to find herself at the old bookshop on Maple Street. The dusty shelves held thousands of forgotten volumes, their spines cracked and faded. She ran her fingers along a row of poetry collections when the bell above the door chimed.\n\nMarcus stepped inside, shaking rain from his jacket. Their eyes met across the narrow aisle, and for a moment, neither spoke.",
      facebook_teaser: "Sometimes the best stories begin in the most unexpected places...",
      facebook_comment: "Part 2 drops tomorrow! Follow for more.",
      hashtags: ["#Romance", "#BookshopMeetCute", "#TestStoryDeleteMe"],
      images: {
        facebook_sfw: [
          {
            position: 1,
            character_name: "TEST_CHAR_Elena",
            prompt:
              "A beautiful Latina woman with long curly dark brown hair browsing books in a cozy bookshop, warm lighting, photorealistic",
          },
        ],
        website_nsfw_paired: [
          {
            pairs_with_facebook: 1,
            character_name: "TEST_CHAR_Elena",
            prompt:
              "A beautiful Latina woman with long curly dark brown hair in a bookshop, intimate angle, warm lighting, photorealistic",
          },
        ],
        website_only: [
          {
            position_after_word: 50,
            character_name: "TEST_CHAR_Marcus",
            prompt:
              "A tall African American man with a close-cropped fade and green eyes entering a bookshop doorway, rain visible behind him, photorealistic",
          },
        ],
      },
    },
    {
      part_number: 2,
      title: "Test Story Part 2: The Conversation",
      facebook_content:
        "Marcus couldn't stop thinking about the woman from the bookshop. When he saw her again at the coffee shop next door, he knew it was fate.\n\nRead the full story on our website!",
      website_content:
        "Marcus couldn't stop thinking about the woman from the bookshop. He'd replayed their brief conversation a hundred times — the way she'd laughed when he admitted he'd come in just to escape the rain.\n\nThe next morning he walked into the coffee shop next door and there she was, sitting in the corner booth with a dog-eared paperback.",
      facebook_teaser: "Some connections are impossible to ignore...",
      facebook_comment: "Thanks for reading! More stories coming soon.",
      hashtags: ["#Romance", "#CoffeeShop", "#TestStoryDeleteMe"],
      images: {
        facebook_sfw: [
          {
            position: 1,
            character_name: "TEST_CHAR_Marcus",
            prompt:
              "A handsome African American man with green eyes sitting in a coffee shop, morning light streaming through the window, photorealistic",
          },
        ],
        website_nsfw_paired: [
          {
            pairs_with_facebook: 1,
            character_name: "TEST_CHAR_Marcus",
            prompt:
              "A handsome African American man with green eyes in a coffee shop, intimate close-up, warm tones, photorealistic",
          },
        ],
        website_only: [
          {
            position_after_word: 40,
            character_name: "TEST_CHAR_Elena",
            prompt:
              "A Latina woman with curly dark hair reading a paperback in a corner booth of a cozy coffee shop, soft warm lighting, photorealistic",
          },
        ],
      },
    },
  ],

  marketing: {
    taglines: [
      "Sometimes love finds you in the last place you'd look.",
      "A chance encounter that changes everything.",
    ],
    posting_schedule: "Daily at 10 AM EST",
    teaser_prompt:
      "A silhouetted couple standing in the doorway of a bookshop at golden hour",
  },
};

// ─── Helpers ───────────────────────────────────────────────────

const results: { label: string; ok: boolean; detail: string }[] = [];

function check(label: string, ok: boolean, detail: string) {
  results.push({ label, ok, detail });
  const icon = ok ? "\u2713" : "\u2717";
  console.log(`  ${icon} ${label}: ${detail}`);
}

async function api(method: string, path: string, body?: unknown) {
  const url = `${BASE_URL}${path}`;
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const json = await res.json();
  return { status: res.status, json };
}

// ─── Main Test ─────────────────────────────────────────────────

async function main() {
  console.log("\n========================================");
  console.log(" No Safe Word — Import Pipeline E2E Test");
  console.log("========================================\n");
  console.log(`Target: ${BASE_URL}\n`);

  // ── Step 1: Import ────────────────────────────────────────
  console.log("Step 1: POST /api/stories/import");
  const { status: importStatus, json: importResult } = await api(
    "POST",
    "/api/stories/import",
    TEST_PAYLOAD
  );

  check("Import HTTP status", importStatus === 201, `${importStatus}`);

  if (importStatus !== 201) {
    console.error("\nImport failed. Response:", JSON.stringify(importResult, null, 2));
    console.log("\nIf you see a duplicate slug error, a previous test run may not have");
    console.log('cleaned up. Archive it via the dashboard or re-run with --cleanup-only.\n');
    process.exit(1);
  }

  const { series_id, slug, posts_created, characters_linked, image_prompts_queued } =
    importResult;

  check("Import: series_id", !!series_id, series_id);
  check("Import: slug", slug === "test-story---delete-me", slug);
  check("Import: posts_created", posts_created === 2, `${posts_created}`);
  check("Import: characters_linked", characters_linked === 2, `${characters_linked}`);
  check(
    "Import: image_prompts_queued",
    image_prompts_queued === 6,
    `${image_prompts_queued} (expected 6: 2 sfw + 2 nsfw_paired + 2 website_only)`
  );

  console.log(`\n  Import result:\n${JSON.stringify(importResult, null, 2)}\n`);

  // ── Step 2: Verify via GET ────────────────────────────────
  console.log(`Step 2: GET /api/stories/${series_id}`);
  const { status: getStatus, json: seriesData } = await api(
    "GET",
    `/api/stories/${series_id}`
  );

  check("GET HTTP status", getStatus === 200, `${getStatus}`);

  if (getStatus !== 200) {
    console.error("\nFailed to fetch series:", JSON.stringify(seriesData, null, 2));
    process.exit(1);
  }

  const { series, posts, characters, image_prompt_counts } = seriesData;

  // Series checks
  check("Series title", series.title === "TEST STORY - DELETE ME", series.title);
  check("Series status", series.status === "characters_pending", series.status);
  check("Series total_parts", series.total_parts === 2, `${series.total_parts}`);
  check("Series hashtag", series.hashtag === "#TestStoryDeleteMe", series.hashtag);
  check(
    "Series marketing",
    Array.isArray(series.marketing?.taglines) && series.marketing.taglines.length === 2,
    `${(series.marketing?.taglines as string[])?.length ?? 0} taglines`
  );

  // Posts checks
  check("Posts count", posts.length === 2, `${posts.length}`);

  const post1 = posts.find((p: { part_number: number }) => p.part_number === 1);
  const post2 = posts.find((p: { part_number: number }) => p.part_number === 2);

  check("Post 1 exists", !!post1, post1 ? post1.title : "MISSING");
  check("Post 2 exists", !!post2, post2 ? post2.title : "MISSING");
  check("Post 1 status", post1?.status === "draft", post1?.status ?? "MISSING");
  check("Post 2 status", post2?.status === "draft", post2?.status ?? "MISSING");
  check(
    "Post 1 hashtags",
    Array.isArray(post1?.hashtags) && post1.hashtags.length === 3,
    `${post1?.hashtags?.length ?? 0} hashtags`
  );

  // Image prompts per post
  const post1Prompts = post1?.story_image_prompts ?? [];
  const post2Prompts = post2?.story_image_prompts ?? [];

  check("Post 1 image prompts", post1Prompts.length === 3, `${post1Prompts.length}`);
  check("Post 2 image prompts", post2Prompts.length === 3, `${post2Prompts.length}`);

  // Check image prompt types on post 1
  const p1Sfw = post1Prompts.filter(
    (p: { image_type: string }) => p.image_type === "facebook_sfw"
  );
  const p1Nsfw = post1Prompts.filter(
    (p: { image_type: string }) => p.image_type === "website_nsfw_paired"
  );
  const p1Only = post1Prompts.filter(
    (p: { image_type: string }) => p.image_type === "website_only"
  );

  check("Post 1: 1 facebook_sfw prompt", p1Sfw.length === 1, `${p1Sfw.length}`);
  check("Post 1: 1 website_nsfw_paired prompt", p1Nsfw.length === 1, `${p1Nsfw.length}`);
  check("Post 1: 1 website_only prompt", p1Only.length === 1, `${p1Only.length}`);

  // Verify NSFW pairing
  check(
    "Post 1: NSFW pairs_with references SFW prompt",
    p1Nsfw.length === 1 && p1Sfw.length === 1 && p1Nsfw[0].pairs_with === p1Sfw[0].id,
    p1Nsfw[0]?.pairs_with
      ? `pairs_with=${p1Nsfw[0].pairs_with}, sfw_id=${p1Sfw[0]?.id}`
      : "no pairing found"
  );

  // All image prompts should be pending
  check(
    "All image prompts status=pending",
    image_prompt_counts.pending === image_prompt_counts.total,
    `${image_prompt_counts.pending}/${image_prompt_counts.total} pending`
  );

  // Characters checks
  check("Characters count", characters.length === 2, `${characters.length}`);

  const charElena = characters.find(
    (c: { characters: { name: string } }) => c.characters?.name === "TEST_CHAR_Elena"
  );
  const charMarcus = characters.find(
    (c: { characters: { name: string } }) => c.characters?.name === "TEST_CHAR_Marcus"
  );

  check("Character Elena linked", !!charElena, charElena ? "found" : "MISSING");
  check("Character Marcus linked", !!charMarcus, charMarcus ? "found" : "MISSING");
  check(
    "Elena role=protagonist",
    charElena?.role === "protagonist",
    charElena?.role ?? "MISSING"
  );
  check(
    "Marcus role=love_interest",
    charMarcus?.role === "love_interest",
    charMarcus?.role ?? "MISSING"
  );
  check(
    "Elena approved=false",
    charElena?.approved === false,
    `${charElena?.approved}`
  );
  check(
    "Marcus approved=false",
    charMarcus?.approved === false,
    `${charMarcus?.approved}`
  );

  // Character structured data
  check(
    "Elena has structured description",
    charElena?.characters?.description?.gender === "female",
    `gender=${charElena?.characters?.description?.gender ?? "MISSING"}`
  );
  check(
    "Marcus has structured description",
    charMarcus?.characters?.description?.gender === "male",
    `gender=${charMarcus?.characters?.description?.gender ?? "MISSING"}`
  );

  // Image prompt character_id resolution
  const sfwWithCharId = post1Prompts.filter(
    (p: { character_id: string | null }) => p.character_id !== null
  );
  check(
    "Image prompts have character_id resolved",
    sfwWithCharId.length > 0,
    `${sfwWithCharId.length}/${post1Prompts.length} have character_id`
  );

  // ── Step 3: Cleanup (archive) ─────────────────────────────
  console.log(`\nStep 3: DELETE /api/stories/${series_id} (archive)`);
  const { status: delStatus, json: delResult } = await api(
    "DELETE",
    `/api/stories/${series_id}`
  );

  check("Archive HTTP status", delStatus === 200, `${delStatus}`);
  check("Archive success", delResult?.success === true, JSON.stringify(delResult));

  // Verify archived
  const { json: afterDel } = await api("GET", `/api/stories/${series_id}`);
  check(
    "Series status after archive",
    afterDel?.series?.status === "archived",
    afterDel?.series?.status ?? "MISSING"
  );

  // ── Summary ───────────────────────────────────────────────
  console.log("\n========================================");
  console.log(" SUMMARY");
  console.log("========================================\n");

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const total = results.length;

  console.log(`  ${passed}/${total} checks passed`);

  if (failed > 0) {
    console.log(`\n  FAILURES:`);
    for (const r of results.filter((r) => !r.ok)) {
      console.log(`    \u2717 ${r.label}: ${r.detail}`);
    }
    console.log("");
    process.exit(1);
  } else {
    console.log("  All checks passed!\n");
  }
}

main().catch((err) => {
  console.error("\nUnexpected error:", err);
  process.exit(1);
});
