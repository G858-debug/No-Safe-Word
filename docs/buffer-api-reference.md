# Buffer Public API — Reference

This is the operational reference for our Buffer integration. Buffer's
public API is a single GraphQL endpoint, in beta as of 2026-05. Update
this file when behavior is verified against a live request, or when
Buffer ships a change that breaks an assumption documented here.

Source of truth at Buffer: <https://developers.buffer.com>.

---

## Endpoint

| Item            | Value                                      |
| --------------- | ------------------------------------------ |
| URL             | `https://api.buffer.com`                   |
| Method          | `POST`                                     |
| Path/version    | None — single endpoint, no `/graphql`      |
| Content-Type    | `application/json`                         |
| Auth header     | `Authorization: Bearer <BUFFER_API_KEY>`   |
| Token issuance  | <https://publish.buffer.com/settings/api>  |

Every request — query or mutation — is a POST to that URL with a JSON
body of the shape `{ "query": "...", "variables": {...} }`.

```bash
curl -X POST 'https://api.buffer.com' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $BUFFER_API_KEY" \
  -d '{"query": "query { account { id email } }"}'
```

---

## Rate limits

Documented at <https://developers.buffer.com/guides/api-limits.html>.

| Scope                       | Limit                  |
| --------------------------- | ---------------------- |
| Per third-party client/account | 100 requests / 15 min |
| Account overall (all clients) | 2000 requests / 15 min |
| Unauthenticated            | 50 requests / 15 min   |

When throttled, Buffer returns HTTP `429` with this error body:

```json
{
  "errors": [{
    "message": "Too many requests from this client. Please try again later.",
    "extensions": {
      "code": "RATE_LIMIT_EXCEEDED",
      "limitType": "CLIENT_ACCOUNT",
      "retryAfter": 900
    }
  }]
}
```

Response headers also returned (use as a cheaper signal than triggering 429):

- `RateLimit-Limit`
- `RateLimit-Remaining`
- `RateLimit-Reset`

For backoff, **prefer the JSON `extensions.retryAfter` (seconds)** over a
Retry-After header. Buffer's docs explicitly direct callers to that field.

For our use (one cron tick/day, plus operator-triggered scheduling), 100
requests / 15 min is well in excess of what we need. Defensive 429
handling matters only for bulk operations — scheduling N posts in a loop.

---

## Errors

GraphQL-style. A 200 OK with an `errors` array is the typical failure
mode. Mutations also return a union payload type, so even on a 200 you
must inspect `__typename` to distinguish success from a typed error.

`PostActionPayload` (the return type of `createPost` / `editPost`) is:

```graphql
union PostActionPayload =
    PostActionSuccess
  | NotFoundError
  | UnauthorizedError
  | UnexpectedError
  | RestProxyError       # message + link + code (legacy network-API errors)
  | LimitReachedError
  | InvalidInputError
```

Always select `__typename` and the `message` field on every payload so
you can branch on the error case without a second round-trip.

---

## Authentication / `account` query

Smoke-test the token. Returns the account, its preferences, and the
list of organizations the token has access to.

```graphql
query Whoami {
  account {
    id
    email
    timezone
    organizations { id name ownerEmail }
  }
}
```

For our installation:

| Field          | Value                                                            |
| -------------- | ---------------------------------------------------------------- |
| Account email  | `mkhwalo88@gmail.com`                                            |
| Account name   | Gugulethu Nkosi                                                  |
| Timezone       | `Africa/Johannesburg`                                            |
| Organization   | `My Organization` — id `69f8d72df8aa92c4351dc1c0`                |

`organizations` is a list — for our installation there is one. If a
future operator connects a second org, our client picks the first by
default; document the override path before that happens.

---

## `channels` query — list connected social accounts

Most write paths require a `ChannelId`. **Never hardcode it** — Buffer
re-issues channel IDs when a page is reconnected.

```graphql
query Channels($organizationId: OrganizationId!) {
  channels(input: { organizationId: $organizationId }) {
    id
    name
    displayName
    service           # facebook | instagram | twitter | ...
    type              # page | profile | business | group | account
    isDisconnected
    isLocked
    timezone
    serviceId         # the Facebook page numeric ID (when service=facebook)
  }
}
```

For our installation today:

| Field         | Value                                  |
| ------------- | -------------------------------------- |
| Channel name  | No Safe Word                           |
| Channel ID    | `69f8d89a5c4c051afa0cf515` (Buffer's)  |
| Service       | `facebook`                             |
| Type          | `page`                                 |
| Connected     | yes                                    |

Filter for `service == "facebook"` and `type == "page"` and (today)
take the only match. If the operator ever connects a second Facebook
page, we'll need to disambiguate by `name`.

---

## `createPost` mutation — schedule a post

The Buffer `Post` is the unit of scheduled content. To schedule a
specific chapter at a specific time:

```graphql
mutation CreateScheduled(
  $channelId: ChannelId!,
  $text: String,
  $dueAt: DateTime,
  $images: [ImageAssetInput!]!,
  $firstComment: String
) {
  createPost(input: {
    channelId: $channelId,
    schedulingType: automatic,    # Buffer publishes for us — requires write scope on the channel
    mode: customScheduled,        # specific dueAt rather than queue/now
    dueAt: $dueAt,                # ISO 8601 in UTC, e.g. "2026-05-12T18:00:00Z"
    text: $text,
    assets: { images: $images },
    metadata: {
      facebook: {
        type: post,
        firstComment: $firstComment,
      }
    }
  }) {
    __typename
    ... on PostActionSuccess { post { id status dueAt } }
    ... on InvalidInputError  { message }
    ... on UnauthorizedError  { message }
    ... on LimitReachedError  { message }
    ... on RestProxyError     { message code link }
    ... on UnexpectedError    { message }
    ... on NotFoundError      { message }
  }
}
```

### Field notes

- **`schedulingType`**: `automatic` (Buffer publishes; needs Buffer to
  hold write permissions on the channel — true for our connected page) or
  `notification` (Buffer pings the operator when due). We always want
  `automatic`.
- **`mode: customScheduled`**: posts at `dueAt` exactly. `addToQueue`
  uses the channel's posting schedule slots, which is not what we want
  — our chapter chain has explicit dates.
- **`dueAt`**: must be a valid `DateTime` scalar. ISO 8601, UTC. SAST is
  UTC+2 with no DST, so 20:00 SAST → `T18:00:00Z` on the same date.
- **`text`**: the post body. For Facebook this maps to the post caption.
- **`assets.images`**: a list of `ImageAssetInput { url, thumbnailUrl?,
  metadata? }`. The `url` must be a publicly reachable URL — Buffer
  fetches from it. Our Supabase Storage public URLs work directly.
- **`metadata.facebook.firstComment`**: string. Buffer auto-posts this as
  the first comment after the main post lands. This is the channel for
  our "see comments to continue on the website" CTA.
- **`metadata.facebook.type`**: `post` (default Facebook feed post),
  `story`, or `reel`. Use `post`.

### Carousel / multiple images

`assets.images` accepts multiple entries. Facebook page posts support
multi-image posts — Buffer handles the carousel layout. Untested with
our chapter formats; if we want >1 SFW image per chapter we should
verify with a dry-run before scheduling a real chain.

---

## `post` query — read status

After scheduling, poll status by `id`. This is what the daily
buffer-sync cron uses to mark posts published in our DB.

```graphql
query GetPost($id: PostId!) {
  post(input: { id: $id }) {
    id
    status         # draft | needs_approval | scheduled | sending | sent | error
    dueAt
    sentAt
    externalLink   # the URL of the published post on Facebook (set when status=sent)
    error { message supportUrl rawError }
    channelId
    channel { service serviceId }
  }
}
```

### Status meaning

| `status`         | What it means for us                                        |
| ---------------- | ----------------------------------------------------------- |
| `draft`          | Saved but not scheduled. We never produce these.            |
| `needs_approval` | Team workflow. Not in our setup.                            |
| `scheduled`      | Sitting in Buffer's queue, dueAt in the future.             |
| `sending`        | Buffer is currently pushing to Facebook.                    |
| `sent`           | Live on Facebook. `externalLink` is populated.              |
| `error`          | Buffer failed to publish. `error.message` has the reason.   |

Our DB columns `buffer_status` and `buffer_error` mirror these. The
operator-facing `story_posts.status` only flips from `scheduled` to
`published` once we observe Buffer reporting `sent`.

### Extracting `facebook_post_id`

`Post.externalLink` is a full URL on `facebook.com`. The numeric post
ID is the trailing path segment. Persist the URL or the parsed ID; the
schema currently has `story_posts.facebook_post_id` as text, so the
parsed ID fits.

---

## `deletePost` mutation — cancel a scheduled post

Used by the "Cancel scheduled posts" UI button. Only succeeds while
status is `scheduled` or `draft`.

```graphql
mutation DeletePost($id: PostId!) {
  deletePost(input: { id: $id }) {
    __typename
    ... on DeletePostSuccess { id }
    ... on VoidMutationError { message }
  }
}
```

If a post has already gone to `sending` or `sent`, this fails — the
post is already on Facebook. We surface that as a "too late to cancel"
error in the UI.

---

## Plan limits

`Account.organizations[i].limits`:

```json
{
  "channels": 1,
  "members": 0,
  "scheduledPosts": 5000,
  "tags": 250,
  "ideas": 5000
}
```

`scheduledPosts: 5000` is the org-wide cap. Each chapter schedules one
post, so a 6-chapter story is 6 against the cap. Decades of runway.

`channels: 1` is fine — we only need the No Safe Word page connected.
If Instagram is added later this needs a plan upgrade.

---

## Things this doc does NOT cover yet

- **Webhooks.** Buffer has webhook delivery for post events (`post.sent`,
  `post.failed`, etc.) which would let us replace the daily sync cron
  with push delivery. Not on the critical path for launch, but a clear
  future improvement.
- **Editing scheduled posts.** `editPost` mutation exists with the same
  shape as `createPost`. We don't expose this in the UI — the operator
  cancels and reschedules — but the mutation is there if needed.
- **Multi-image carousel testing.** Untested against Facebook page
  service. Verify before relying on it.
- **The `recurrence` API.** Buffer supports recurring schedules but our
  chain is one-shot, so we don't use it.
