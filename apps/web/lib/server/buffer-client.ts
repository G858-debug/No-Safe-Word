// Buffer Public API client.
//
// Buffer's API is a single GraphQL endpoint, in beta as of 2026-05.
// All operations are POST https://api.buffer.com with a JSON body of
// the shape { query, variables }. See docs/buffer-api-reference.md for
// the full surface.
//
// This wrapper exposes a small typed API to the rest of the codebase
// (schedulePost, getPostStatus, listChannels, ...) so callers don't
// touch GraphQL directly. Errors are normalised to a typed shape;
// rate-limit responses are turned into a typed BufferRateLimited error
// so callers can decide whether to retry.

import { take } from "./rate-limit";
import { logEvent } from "./events";

const BUFFER_API_URL = "https://api.buffer.com";
const FETCH_TIMEOUT_MS = 10_000;

// Per-organization-token rate limit per Buffer's published docs is
// 100 req / 15 min. We conservatively cap at 80 / 15 min in our own
// process-local limiter so a defensive caller doesn't trip the upstream
// limit and burn a 429.
const RATE_LIMIT_COUNT = 80;
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

// Channel ID lookup is cached in process memory for one hour. Refresh
// on miss or on any auth error from Buffer (an auth error suggests the
// token was rotated, which would also mean a new connection state).
const CHANNEL_CACHE_TTL_MS = 60 * 60 * 1000;

export interface BufferChannel {
  id: string;
  name: string;
  displayName: string | null;
  service: string;
  type: string;
  isDisconnected: boolean;
  isLocked: boolean;
  serviceId: string | null;
}

export interface BufferImageInput {
  url: string;
  thumbnailUrl?: string;
}

export interface SchedulePostInput {
  channelId: string;
  text: string;
  scheduledAt: Date;
  imageUrls?: string[];
  firstComment?: string;
}

export interface ScheduledPost {
  id: string;
  status: BufferPostStatusValue;
  dueAt: string | null;
}

export type BufferPostStatusValue =
  | "draft"
  | "needs_approval"
  | "scheduled"
  | "sending"
  | "sent"
  | "error";

export interface BufferPostStatus {
  id: string;
  status: BufferPostStatusValue;
  dueAt: string | null;
  sentAt: string | null;
  externalLink: string | null;
  error: string | null;
}

export type HealthCheckResult =
  | { ok: true; account: { id: string; email: string } }
  | { ok: false; error: string };

// Typed error class so callers can `instanceof` and react to specific
// failure modes without parsing strings.
export class BufferApiError extends Error {
  readonly code: string;
  readonly retryAfterSeconds: number | null;
  readonly httpStatus: number | null;

  constructor(opts: {
    message: string;
    code: string;
    retryAfterSeconds?: number | null;
    httpStatus?: number | null;
  }) {
    super(opts.message);
    this.name = "BufferApiError";
    this.code = opts.code;
    this.retryAfterSeconds = opts.retryAfterSeconds ?? null;
    this.httpStatus = opts.httpStatus ?? null;
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface ChannelCacheEntry {
  id: string;
  expiresAt: Date;
}
let cachedFacebookChannel: ChannelCacheEntry | null = null;

function getApiKey(): string {
  const key = process.env.BUFFER_API_KEY;
  if (!key) {
    throw new BufferApiError({
      message: "BUFFER_API_KEY is not set",
      code: "MISSING_API_KEY",
    });
  }
  return key;
}

function getOrgId(): string | null {
  // Optional override — by default we discover the organization via the
  // account query on first health-check / channel listing.
  return process.env.BUFFER_ORGANIZATION_ID || null;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    extensions?: {
      code?: string;
      retryAfter?: number;
      limitType?: string;
    };
  }>;
}

/**
 * Issue one POST to Buffer's GraphQL endpoint with the given query and
 * variables. Throws BufferApiError on any failure (network, HTTP non-2xx,
 * GraphQL errors, or auth/rate-limit errors). On success, returns the
 * parsed `data` payload typed to T.
 *
 * Caller is expected to provide the operationName string for logging /
 * rate-limit bucketing.
 */
async function gqlRequest<T>(
  operationName: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  // Process-local rate-limit gate. Bucketed by operation so e.g. a noisy
  // healthCheck loop doesn't starve schedulePost.
  const rl = take(
    "buffer_api",
    `op:${operationName}`,
    RATE_LIMIT_COUNT,
    RATE_LIMIT_WINDOW_SECONDS
  );
  if (!rl.ok) {
    throw new BufferApiError({
      message: `Local rate limit exceeded for ${operationName} (retry in ${rl.retryAfterSeconds}s)`,
      code: "LOCAL_RATE_LIMITED",
      retryAfterSeconds: rl.retryAfterSeconds,
    });
  }

  const apiKey = getApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let httpStatus = 0;
  let response: Response;
  try {
    response = await fetch(BUFFER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    httpStatus = response.status;
  } catch (err) {
    clearTimeout(timeout);
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Buffer request timed out after ${FETCH_TIMEOUT_MS}ms`
          : err.message
        : "Unknown fetch error";
    void logEvent({
      eventType: "buffer.api_call",
      metadata: { operation: operationName, ok: false, transport_error: message },
    });
    throw new BufferApiError({
      message: `Buffer request failed: ${message}`,
      code: "TRANSPORT_ERROR",
    });
  }
  clearTimeout(timeout);

  // Buffer returns 429 with a JSON body that includes extensions.retryAfter.
  // Surface that as a typed error so callers can decide.
  let body: GraphQLResponse<T> | null = null;
  try {
    body = (await response.json()) as GraphQLResponse<T>;
  } catch {
    // Non-JSON body — fall through to the http-status branch below.
  }

  if (!response.ok) {
    const retryAfter =
      body?.errors?.[0]?.extensions?.retryAfter ?? null;
    const code =
      body?.errors?.[0]?.extensions?.code ??
      (response.status === 429 ? "RATE_LIMIT_EXCEEDED" : "HTTP_ERROR");
    const message =
      body?.errors?.[0]?.message ??
      `Buffer returned HTTP ${response.status}`;

    // If the upstream returned an auth failure, blow away the channel
    // cache so the next channel lookup re-fetches under the new
    // (presumably rotated) credentials.
    if (
      response.status === 401 ||
      response.status === 403 ||
      code === "UNAUTHORIZED"
    ) {
      cachedFacebookChannel = null;
    }

    void logEvent({
      eventType: "buffer.api_call",
      metadata: {
        operation: operationName,
        ok: false,
        http_status: response.status,
        code,
      },
    });
    throw new BufferApiError({
      message,
      code,
      retryAfterSeconds: retryAfter,
      httpStatus,
    });
  }

  if (body?.errors && body.errors.length > 0) {
    const first = body.errors[0];
    const code = first.extensions?.code ?? "GRAPHQL_ERROR";

    if (code === "UNAUTHORIZED") {
      cachedFacebookChannel = null;
    }

    void logEvent({
      eventType: "buffer.api_call",
      metadata: { operation: operationName, ok: false, code },
    });
    throw new BufferApiError({
      message: first.message,
      code,
      retryAfterSeconds: first.extensions?.retryAfter ?? null,
      httpStatus,
    });
  }

  if (!body?.data) {
    void logEvent({
      eventType: "buffer.api_call",
      metadata: { operation: operationName, ok: false, code: "EMPTY_RESPONSE" },
    });
    throw new BufferApiError({
      message: "Buffer returned an empty response body",
      code: "EMPTY_RESPONSE",
      httpStatus,
    });
  }

  void logEvent({
    eventType: "buffer.api_call",
    metadata: { operation: operationName, ok: true, http_status: httpStatus },
  });
  return body.data;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

const ACCOUNT_QUERY = /* GraphQL */ `
  query Whoami {
    account {
      id
      email
      timezone
      organizations {
        id
        name
        ownerEmail
      }
    }
  }
`;

interface AccountQueryData {
  account: {
    id: string;
    email: string;
    timezone: string | null;
    organizations: Array<{ id: string; name: string; ownerEmail: string }>;
  };
}

const CHANNELS_QUERY = /* GraphQL */ `
  query Channels($organizationId: OrganizationId!) {
    channels(input: { organizationId: $organizationId }) {
      id
      name
      displayName
      service
      type
      isDisconnected
      isLocked
      serviceId
    }
  }
`;

interface ChannelsQueryData {
  channels: BufferChannel[];
}

const CREATE_POST_MUTATION = /* GraphQL */ `
  mutation CreatePost(
    $channelId: ChannelId!
    $text: String
    $dueAt: DateTime
    $assets: AssetsInput
    $metadata: PostInputMetaData
  ) {
    createPost(
      input: {
        channelId: $channelId
        schedulingType: automatic
        mode: customScheduled
        dueAt: $dueAt
        text: $text
        assets: $assets
        metadata: $metadata
      }
    ) {
      __typename
      ... on PostActionSuccess {
        post {
          id
          status
          dueAt
        }
      }
      ... on InvalidInputError {
        message
      }
      ... on UnauthorizedError {
        message
      }
      ... on LimitReachedError {
        message
      }
      ... on RestProxyError {
        message
        code
      }
      ... on UnexpectedError {
        message
      }
      ... on NotFoundError {
        message
      }
    }
  }
`;

type CreatePostData = {
  createPost:
    | {
        __typename: "PostActionSuccess";
        post: { id: string; status: BufferPostStatusValue; dueAt: string | null };
      }
    | {
        __typename:
          | "InvalidInputError"
          | "UnauthorizedError"
          | "LimitReachedError"
          | "RestProxyError"
          | "UnexpectedError"
          | "NotFoundError";
        message: string;
        code?: number;
      };
};

const POST_QUERY = /* GraphQL */ `
  query GetPost($id: PostId!) {
    post(input: { id: $id }) {
      id
      status
      dueAt
      sentAt
      externalLink
      error {
        message
      }
    }
  }
`;

interface PostQueryData {
  post: {
    id: string;
    status: BufferPostStatusValue;
    dueAt: string | null;
    sentAt: string | null;
    externalLink: string | null;
    error: { message: string } | null;
  };
}

const DELETE_POST_MUTATION = /* GraphQL */ `
  mutation DeletePost($id: PostId!) {
    deletePost(input: { id: $id }) {
      __typename
      ... on DeletePostSuccess {
        id
      }
      ... on VoidMutationError {
        message
      }
    }
  }
`;

type DeletePostData = {
  deletePost:
    | { __typename: "DeletePostSuccess"; id: string }
    | { __typename: "VoidMutationError"; message: string };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the active Buffer organization for this token. Caches the
 * result in process memory for the lifetime of the process — orgs do
 * not migrate.
 */
let cachedOrgId: string | null = null;
async function resolveOrganizationId(): Promise<string> {
  const fromEnv = getOrgId();
  if (fromEnv) return fromEnv;
  if (cachedOrgId) return cachedOrgId;

  const data = await gqlRequest<AccountQueryData>(
    "account",
    ACCOUNT_QUERY,
    {}
  );
  const orgs = data.account.organizations;
  if (!orgs || orgs.length === 0) {
    throw new BufferApiError({
      message: "Buffer account has no organizations",
      code: "NO_ORGANIZATION",
    });
  }
  cachedOrgId = orgs[0].id;
  return cachedOrgId;
}

export const bufferClient = {
  /** List every channel connected to the active organization. */
  async listChannels(): Promise<BufferChannel[]> {
    const organizationId = await resolveOrganizationId();
    const data = await gqlRequest<ChannelsQueryData>(
      "channels",
      CHANNELS_QUERY,
      { organizationId }
    );
    return data.channels;
  },

  /**
   * Resolve the channel id of the connected Facebook page. Cached in
   * process memory for 1 hour. Cache is invalidated on auth errors
   * (handled inside gqlRequest). Returns null if no Facebook page is
   * connected.
   */
  async getFacebookPageChannelId(): Promise<string | null> {
    const now = new Date();
    if (
      cachedFacebookChannel &&
      cachedFacebookChannel.expiresAt.getTime() > now.getTime()
    ) {
      return cachedFacebookChannel.id;
    }

    const channels = await this.listChannels();
    const fb = channels.find(
      (c) =>
        c.service === "facebook" &&
        c.type === "page" &&
        !c.isDisconnected &&
        !c.isLocked
    );
    if (!fb) {
      cachedFacebookChannel = null;
      return null;
    }
    cachedFacebookChannel = {
      id: fb.id,
      expiresAt: new Date(now.getTime() + CHANNEL_CACHE_TTL_MS),
    };
    return fb.id;
  },

  /**
   * Schedule a single Facebook post. Buffer publishes automatically at
   * `scheduledAt` (UTC). On success, returns the Buffer-side post id
   * and status so the caller can persist them.
   */
  async schedulePost(input: SchedulePostInput): Promise<ScheduledPost> {
    const variables: Record<string, unknown> = {
      channelId: input.channelId,
      text: input.text,
      dueAt: input.scheduledAt.toISOString(),
      assets:
        input.imageUrls && input.imageUrls.length > 0
          ? {
              images: input.imageUrls.map((url) => ({ url })),
            }
          : null,
      metadata: {
        facebook: {
          type: "post",
          firstComment: input.firstComment ?? null,
        },
      },
    };

    const data = await gqlRequest<CreatePostData>(
      "createPost",
      CREATE_POST_MUTATION,
      variables
    );

    const result = data.createPost;
    if (result.__typename !== "PostActionSuccess") {
      throw new BufferApiError({
        message: `Buffer createPost rejected: ${result.message}`,
        code: result.__typename,
      });
    }

    const post = result.post;
    void logEvent({
      eventType: "buffer.scheduled",
      metadata: {
        buffer_post_id: post.id,
        channel_id: input.channelId,
        due_at: variables.dueAt,
        image_count: input.imageUrls?.length ?? 0,
        has_first_comment: !!input.firstComment,
      },
    });
    return {
      id: post.id,
      status: post.status,
      dueAt: post.dueAt,
    };
  },

  /** Read the current Buffer-side status of a previously scheduled post. */
  async getPostStatus(bufferPostId: string): Promise<BufferPostStatus> {
    const data = await gqlRequest<PostQueryData>("post", POST_QUERY, {
      id: bufferPostId,
    });
    return {
      id: data.post.id,
      status: data.post.status,
      dueAt: data.post.dueAt,
      sentAt: data.post.sentAt,
      externalLink: data.post.externalLink,
      error: data.post.error?.message ?? null,
    };
  },

  /**
   * Cancel a scheduled post. Throws BufferApiError if Buffer rejects
   * the cancel (e.g. the post is already sending or sent).
   */
  async cancelPost(bufferPostId: string): Promise<void> {
    const data = await gqlRequest<DeletePostData>(
      "deletePost",
      DELETE_POST_MUTATION,
      { id: bufferPostId }
    );

    const result = data.deletePost;
    if (result.__typename !== "DeletePostSuccess") {
      throw new BufferApiError({
        message: `Buffer deletePost rejected: ${result.message}`,
        code: result.__typename,
      });
    }

    void logEvent({
      eventType: "buffer.cancelled",
      metadata: { buffer_post_id: bufferPostId },
    });
  },

  /**
   * Smoke-test the API key. Cheap query — used by the weekly health-check
   * cron to surface broken tokens before publish day.
   */
  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const data = await gqlRequest<AccountQueryData>(
        "account",
        ACCOUNT_QUERY,
        {}
      );
      return {
        ok: true,
        account: { id: data.account.id, email: data.account.email },
      };
    } catch (err) {
      const message =
        err instanceof BufferApiError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Unknown error";
      return { ok: false, error: message };
    }
  },
};
