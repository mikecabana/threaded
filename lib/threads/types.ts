// Domain types for Threads data. The Phase 1 API client maps graph.threads.net
// responses (snake_case) into these.

export type ThreadsMediaType = "TEXT_POST" | "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | "AUDIO" | "REPOST_FACADE";

export interface ThreadsProfile {
  id: string;
  username: string;
  name: string;
  biography: string;
  profilePictureUrl: string | null;
  isVerified: boolean;
}

export interface ThreadsPost {
  id: string;
  text: string;
  /** ISO 8601, UTC. */
  timestamp: string;
  mediaType: ThreadsMediaType;
  permalink: string;
  isQuotePost: boolean;
  topicTag: string | null;
}

/** GET /{media-id}/insights */
export interface PostInsights {
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  shares: number;
}

/** One day of GET /{user-id}/threads_insights, plus our own follower snapshot. */
export interface AccountDay {
  /** YYYY-MM-DD in UTC. */
  date: string;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  followersCount: number;
}

export interface PostWithInsights extends ThreadsPost {
  insights: PostInsights;
}
