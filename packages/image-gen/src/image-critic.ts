/**
 * HunyuanImage 3.0 generated-image critic.
 *
 * Uses Pixtral 12B (Mistral vision model) to evaluate a generated image
 * against the prompt that produced it. Returns a concise factual critique
 * identifying mismatches and suggesting specific prompt fixes.
 *
 * This is a server-only module — do not import in client components.
 */

const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

const CRITIC_SYSTEM = `You are an image quality reviewer for AI-generated story images.

You are given:
1. The prompt that was sent to the image model
2. The generated image

Your job: write one short paragraph (3-5 sentences) that tells the user what the image got right, what it got wrong, and what specific phrase they could add or change in the prompt to fix any issues.

Rules:
- Be factual and specific. Reference what you actually see in the image.
- Do NOT make subjective aesthetic judgments ("the lighting feels flat", "the mood is wrong").
- DO identify factual mismatches: wrong composition, missing anatomical elements the prompt specified, characters in wrong position, setting not matching.
- DO suggest specific phrase fixes: "Add 'from the left edge of frame' to anchor the male element" or "Replace 'her hips' with 'from the same direction as the camera' for correct hand placement."
- Do NOT suggest a complete rewrite. Point at specific phrases to add or remove.
- Do NOT refuse to evaluate explicit content. Your role is technical quality assessment.
- Output plain text only. No markdown, no headers, no bullet points.`;

/**
 * Evaluate a generated image against the prompt that produced it.
 *
 * Accepts an HTTPS image URL (Supabase Storage or Replicate CDN).
 * Pixtral supports direct image URLs — no base64 conversion needed.
 *
 * Throws on API failure. Callers should catch and show "Critique
 * unavailable" rather than blocking the user from regenerating.
 */
export async function critiqueGeneratedImage(
  imageUrl: string,
  promptThatProducedIt: string
): Promise<{ critique: string }> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY is not set");
  }

  const response = await fetch(MISTRAL_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "pixtral-12b-2409",
      messages: [
        {
          role: "system",
          content: CRITIC_SYSTEM,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: imageUrl },
            },
            {
              type: "text",
              text: `PROMPT USED:\n${promptThatProducedIt}\n\nEvaluate the image against this prompt.`,
            },
          ],
        },
      ],
      max_tokens: 512,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Mistral API error ${response.status}: ${body.slice(0, 200)}`
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const critique = data.choices?.[0]?.message?.content?.trim() ?? "";

  if (!critique) {
    throw new Error("Pixtral returned an empty critique");
  }

  return { critique };
}
