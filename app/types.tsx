export interface UserContextTypes {
  user: User | null;
  /**
   * True until the first auth check settles. `user` is null both before and
   * after that check, so anything that acts on "logged out" -- a redirect, a
   * login prompt -- has to wait for this to be false or it fires against a
   * signed-in visitor whose session simply has not loaded yet.
   */
  isCheckingUser: boolean;
  register: (name: string, email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkUser: () => Promise<void>;
}

export interface User {
  id: string,
  name: string,
  bio: string,
  image: string,
}

export interface Profile {
  id: string;
  user_id: string;
  name: string;
  image: string;
  bio: string;
}

export interface RandomUsers {
  id: string;
  name: string;
  image: string;
}

export interface CropperDimensions {
  height?: number | null;
  width?: number | null;
  left?: number | null;
  top?: number | null;
}

export interface Like {
  id: string;
  user_id: string;
  post_id: string;
}

export interface Follow {
  id: string;
  user_id: string;
  to_user_id: string;
}

export interface Post {
  id: string;
  user_id: string;
  video_url: string;
  text: string;
  created_at: string;
}

export type PostMediaKind = 'video' | 'image'

/**
 * One row of public.feed_post. Counters and the viewer's own like/save/repost/
 * follow state arrive WITH the post from get_feed, so a card renders without
 * fetching anything of its own.
 */
export interface PostWithProfile {
  id: string;
  user_id: string;
  video_url: string;
  text: string;
  created_at: string;
  /** Storage key of the cover frame. Empty for posts uploaded before covers. */
  poster_key: string;
  media_kind: PostMediaKind;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  like_count: number;
  comment_count: number;
  save_count: number;
  repost_count: number;
  share_count: number;
  view_count: number;
  is_liked: boolean;
  is_saved: boolean;
  is_reposted: boolean;
  is_following: boolean;
  /**
   * Ranking score as the exact decimal STRING the server sent. Never parse it:
   * the feed cursor compares it as a numeric tuple server-side, and a JS
   * round-trip changes the value. See app/utils/feedCursor.ts.
   */
  score: string;
  profile: {
      user_id: string;
      name: string;
      image: string;
  }
}

/**
 * A comment now lives in app/utils/commentThread.ts as `CommentNode`, which
 * carries the fields 0007 added -- parent_id, like_count, reply_count and the
 * viewer's own like state -- and is shaped by the RPCs that return it.
 */

export interface Comment {
  id: string;
  user_id: string;
  post_id: string;
  text: string;
  created_at: string;
}

export interface ShowErrorObject {
  type: string;
  message: string;
}

export interface UploadError {
  type: string;
  message: string;
}

//////////////////////////////////////////////
//////////////////////////////////////////////

// COMPONENT TYPES
export interface CommentsHeaderCompTypes {
  params: { userId: string; postId: string; };
  post: PostWithProfile
  isMobileDetail?: boolean;
}

export interface CommentsCompTypes {
  params: { userId: string; postId: string; };
  isMobileDetail?: boolean;
  autoFocusInput?: boolean;
}

export interface PostPageTypes {
  params: { userId: string; postId: string; };
}

export interface ProfilePageTypes {
  params: { id: string; };
}

export interface PostUserCompTypes {
  // Was `Post`. Grid tiles now read like_count straight off the row instead of
  // issuing one query per tile.
  post: PostWithProfile
}

export interface PostMainCompTypes {
  post: PostWithProfile
  feedIndex?: number
  isAutoScrollEnabled: boolean
  onVideoEnded: (postId: string) => void
  onAutoScrollChange: (enabled: boolean) => void
  /** Removes the card from the feed after Not Interested or a block. */
  onRemove?: (postId: string) => void
  /** Lifts counter/flag changes back into the feed store so they survive scroll. */
  onPostChange?: (postId: string, patch: Partial<PostWithProfile>) => void
  /**
   * Reports which post is in the floating player, or null. The feed keeps that
   * card mounted regardless of the virtualization window -- unmounting the
   * <video> closes the floating window.
   */
  onFloatingPlayerChange?: (postId: string | null) => void
}

export interface TextInputCompTypes {
  string: string;
  inputType: string;
  placeholder: string;
  onUpdate: (newValue: string) => void;
  error: string;
}


//////////////////////////////////////////////
//////////////////////////////////////////////

// LAYOUT INCLUDE TYPES
export interface MenuItemTypes {
  iconString: string,
  colorString: string,
  sizeString: string
}

export interface MenuItemFollowCompTypes {
  user: RandomUsers
}
