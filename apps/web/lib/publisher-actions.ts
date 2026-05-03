// Client helpers for the Publisher's per-image actions on the Publish
// tab: hero selection, exclude toggle, position writes. All three
// follow the same shape — POST a small JSON body, return on 2xx,
// throw the server error message on non-2xx so callers can roll back
// optimistic state.

export async function setHero(postId: string, promptId: string | null): Promise<void> {
  const res = await fetch(`/api/stories/posts/${postId}/set-hero`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ promptId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || "Failed to set hero");
  }
}

export interface ExcludeResult {
  excluded: boolean;
  heroCleared: boolean;
}

export async function setExcluded(
  postId: string,
  promptId: string,
  excluded: boolean
): Promise<ExcludeResult> {
  const res = await fetch(
    `/api/stories/posts/${postId}/images/${promptId}/exclude`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ excluded }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || "Failed to update exclude flag");
  }
  const data = await res.json();
  return {
    excluded: Boolean(data.excluded),
    heroCleared: Boolean(data.heroCleared),
  };
}

export async function setImagePosition(
  postId: string,
  promptId: string,
  positionAfterWord: number | null
): Promise<void> {
  const res = await fetch(
    `/api/stories/posts/${postId}/images/${promptId}/position`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positionAfterWord }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || "Failed to update image position");
  }
}
