export type ChatMessageType = "message" | "votingPoll" | "question" | "answer";
export type MemberRank = "BRONZE" | "SILBER" | "GOLD" | "PLATIN" | "DIAMANT" | "ONYX" | "TITAN";

export interface MemberProgressDTO {
  brand: "PPC Score" | "PPC Member";
  score: number;
  rank: MemberRank;
  nextRank?: MemberRank;
  pointsToNext?: number;
  lastActiveAt?: string;
}

export type SseEventName =
  | "snapshot"
  | "presence.updated"
  | "message.created"
  | "message.updated"
  | "rank.up"
  | "app.kill.updated"
  | "taste.updated"
  | "reaction.received"
  | "notification.created"
  | "notification.read"
  | "poll.updated"
  | "user.updated"
  | "bot.updated"
  | "bot.deleted"
  | "chat.background.updated"
  | "ai.status";

export interface AuthSignUpRequest {
  loginName: string;
  password: string;
  displayName: string;
  profilePicture?: string;
}

export interface AuthSignInRequest {
  loginName: string;
  password: string;
}

export interface RestoreSessionRequest {
  clientId: string;
  sessionToken: string;
}

export interface AuthSessionDTO extends UserPresenceDTO {
  loginName: string;
  sessionToken: string;
  sessionExpiresAt: string;
  devMode: boolean;
  devAuthToken?: string;
}

export type LoginRequest = RestoreSessionRequest;
export type LoginResponseDTO = AuthSessionDTO;

export interface RenameUserRequest {
  clientId: string;
  newUsername?: string;
  profilePicture?: string;
}

export interface UpdateOwnAccountRequest {
  clientId: string;
  currentPassword: string;
  newLoginName?: string;
  newPassword?: string;
}

export type BotLanguagePreference = "de" | "en" | "all";

export interface CreateBotRequest {
  clientId: string;
  displayName: string;
  profilePicture?: string;
  mentionHandle: string;
  languagePreference?: BotLanguagePreference;
  instructions: string;
  catchphrases: string[];
  autonomousEnabled?: boolean;
  autonomousMinIntervalMinutes?: number;
  autonomousMaxIntervalMinutes?: number;
  autonomousPrompt?: string;
}

export interface UpdateBotRequest extends CreateBotRequest {}

export interface DeleteBotRequest {
  clientId: string;
}

export interface PresencePingRequest {
  clientId: string;
}

export interface TypingRequest {
  clientId: string;
  status: string;
}

export interface UpdateChatBackgroundRequest {
  clientId: string;
  url?: string | null;
}

export interface CreateMessageRequest {
  clientId: string;
  type: ChatMessageType;
  message: string;
  optionOne?: string;
  optionTwo?: string;
  pollOptions?: string[];
  pollMultiSelect?: boolean;
  pollAllowVoteChange?: boolean;
  questionId?: string;
}

export interface VotePollRequest {
  clientId: string;
  pollMessageId: string;
  side?: "left" | "right";
  optionIds?: string[];
}

export type ReactionType = "LIKE" | "LOL" | "FIRE" | "BASED" | "WTF" | "BIG_BRAIN";

export interface ReactMessageRequest {
  clientId: string;
  messageId: string;
  reaction: ReactionType;
}

export interface ExtendPollRequest {
  clientId: string;
  pollMessageId: string;
  pollOptions: string[];
}

export type AdminActionType =
  | "reset_all"
  | "delete_all_messages"
  | "logout_all_users"
  | "clear_blacklist"
  | "delete_user"
  | "delete_message"
  | "set_user_score"
  | "set_user_rank"
  | "toggle_kill_all";

export interface AdminOverviewRequest {
  clientId: string;
  devAuthToken: string;
}

export interface AdminActionRequest extends AdminOverviewRequest {
  action: AdminActionType;
  targetUserId?: string;
  targetUsername?: string;
  targetMessageId?: string;
  targetScore?: number;
  targetRank?: MemberRank;
  killEnabled?: boolean;
}

export interface AppKillDTO {
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface AdminOverviewDTO {
  usersTotal: number;
  usersOnline: number;
  messagesTotal: number;
  pollsTotal: number;
  blacklistTotal: number;
  appKill: AppKillDTO;
}

export interface AdminActionResponse {
  ok: true;
  message: string;
  overview: AdminOverviewDTO;
}

export interface AdminUserListItemDTO {
  userId: string;
  clientId: string;
  username: string;
  profilePicture: string;
  loginName: string | null;
  hasAccount: boolean;
  canResetPassword: boolean;
  isOnline: boolean;
  member?: MemberProgressDTO;
  memberRawScore: number;
  stats: PublicUserProfileStatsDTO;
}

export interface AdminUserListResponseDTO {
  items: AdminUserListItemDTO[];
}

export interface AdminResetUserPasswordRequest extends AdminOverviewRequest {
  targetUserId: string;
  newPassword: string;
}

export interface AdminResetUserPasswordResponse {
  ok: true;
  message: string;
}

export interface BotIdentityDTO {
  id: string;
  clientId: string;
  displayName: string;
  mentionHandle: string;
  createdByUserId: string;
  createdByUsername: string;
  provider: "grok";
}

export interface ManagedBotDTO {
  id: string;
  displayName: string;
  profilePicture: string;
  mentionHandle: string;
  languagePreference: BotLanguagePreference;
  instructions: string;
  catchphrases: string[];
  autonomousEnabled?: boolean;
  autonomousMinIntervalMinutes?: number;
  autonomousMaxIntervalMinutes?: number;
  autonomousPrompt?: string;
  autonomousNextAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BotManagerDTO {
  items: ManagedBotDTO[];
  limit: number;
  used: number;
  remaining: number;
}

export interface DeveloperUserTasteDTO {
  userId: string;
  clientId: string;
  username: string;
  profilePicture: string;
  windowDays: number;
  updatedAt: string;
  reactionsReceived: number;
  reactionDistribution: Array<{ reaction: ReactionType; count: number }>;
  topTags: Array<{ tag: string; score: number }>;
}

export interface DeveloperUserTasteListDTO {
  items: DeveloperUserTasteDTO[];
}

export interface UserPresenceDTO {
  id: string;
  clientId: string;
  username: string;
  profilePicture: string;
  status: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  mentionHandle?: string;
  member?: MemberProgressDTO;
  bot?: BotIdentityDTO;
}

export interface PublicUserProfileStatsDTO {
  postsTotal: number;
  reactionsGiven: number;
  reactionsReceived: number;
  pollsCreated: number;
  pollVotes: number;
  activeDays: number;
}

export interface PublicUserProfileDTO {
  userId: string;
  clientId: string;
  username: string;
  profilePicture: string;
  status: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  memberSince: string | null;
  mentionHandle?: string;
  member?: MemberProgressDTO;
  bot?: BotIdentityDTO;
  stats: PublicUserProfileStatsDTO;
}

export type MessageTaggingStatus = "pending" | "processing" | "completed" | "failed";

export interface ScoredTagDTO {
  tag: string;
  score: number;
}

export interface MessageTagCategorySetDTO {
  themes: ScoredTagDTO[];
  humor: ScoredTagDTO[];
  art: ScoredTagDTO[];
  tone: ScoredTagDTO[];
  topics: ScoredTagDTO[];
}

export interface ImageTagCategorySetDTO {
  themes: ScoredTagDTO[];
  humor: ScoredTagDTO[];
  art: ScoredTagDTO[];
  tone: ScoredTagDTO[];
  objects: ScoredTagDTO[];
}

export interface ImageTaggingDTO {
  imageUrl: string;
  tags: ScoredTagDTO[];
  categories: ImageTagCategorySetDTO;
}

export interface MessageTaggingDTO {
  status: MessageTaggingStatus;
  provider: "grok";
  model: string;
  language: "en";
  generatedAt?: string;
  error?: string;
  messageTags: ScoredTagDTO[];
  categories: MessageTagCategorySetDTO;
  images: ImageTaggingDTO[];
}

export interface MessageReactionsDTO {
  total: number;
  score: number;
  viewerReaction: ReactionType | null;
  summary: Array<{
    reaction: ReactionType;
    count: number;
    users: Array<{
      id: string;
      username: string;
      profilePicture: string;
    }>;
  }>;
}

export interface MessageDTO {
  id: string;
  authorId?: string;
  type: ChatMessageType;
  message: string;
  username: string;
  profilePicture: string;
  createdAt: string;
  optionOne?: string;
  optionTwo?: string;
  resultone?: string;
  resulttwo?: string;
  questionId?: string;
  oldusername?: string;
  oldmessage?: string;
  member?: MemberProgressDTO;
  bot?: BotIdentityDTO;
  tagging?: MessageTaggingDTO;
  reactions?: MessageReactionsDTO;
  poll?: {
    options: Array<{
      id: string;
      label: string;
      votes: number;
      voters: Array<{
        id: string;
        username: string;
        profilePicture: string;
      }>;
    }>;
    settings: {
      multiSelect: boolean;
      allowVoteChange: boolean;
    };
  };
}

export interface MessagePageDTO {
  messages: MessageDTO[];
  hasMore: boolean;
}

export interface MediaItemDTO {
  id: string;
  url: string;
  username: string;
  createdAt: string;
}

export interface MediaPageDTO {
  items: MediaItemDTO[];
  hasMore: boolean;
  nextCursor: string | null;
  total: number;
}

export interface NotificationDTO {
  id: string;
  userId: string;
  actorUserId?: string;
  actorUsername: string;
  messageId: string;
  reaction: ReactionType;
  messagePreview: string;
  isRead: boolean;
  createdAt: string;
  readAt?: string;
}

export interface NotificationPageDTO {
  items: NotificationDTO[];
  unreadCount: number;
}

export interface MarkNotificationsReadRequest {
  clientId: string;
  notificationIds?: string[];
}

export interface UserTasteProfileDTO {
  userId: string;
  windowDays: number;
  updatedAt: string;
  reactionsReceived: number;
  reactionDistribution: Array<{ reaction: ReactionType; count: number }>;
  topTags: Array<{ tag: string; score: number }>;
}

export type TasteWindowKey = "7d" | "30d" | "all";

export type TasteProfileEventType =
  | "MESSAGE_CREATED"
  | "USERNAME_CHANGED"
  | "MESSAGE_TAGGING_COMPLETED"
  | "MESSAGE_TAGGING_FAILED"
  | "REACTION_GIVEN"
  | "REACTION_RECEIVED"
  | "POLL_CREATED"
  | "POLL_EXTENDED"
  | "POLL_VOTE_GIVEN"
  | "AI_MENTION_SENT";

export interface TasteProfileDetailedDTO {
  userId: string;
  generatedAt: string;
  member?: MemberProgressDTO;
  memberBreakdown: {
    botsCreated: number;
    messagesCreated: number;
    reactionsGiven: number;
    reactionsReceived: number;
    aiMentions: number;
    pollsCreated: number;
    pollsExtended: number;
    pollVotes: number;
    taggingCompleted: number;
    usernameChanges: number;
    rawScore: number;
  };
  windows: Record<TasteWindowKey, TasteWindowStatsDTO>;
  transparency: {
    eventRetentionDays: number;
    rawEventsAvailableSince?: string;
    sources: string[];
  };
}

export interface TasteWindowStatsDTO {
  reactions: {
    givenTotal: number;
    receivedTotal: number;
    givenByType: Array<{ reaction: ReactionType; count: number }>;
    receivedByType: Array<{ reaction: ReactionType; count: number }>;
  };
  interests: {
    topTags: Array<{ tag: string; score: number }>;
    topMessageCategories: {
      themes: Array<{ tag: string; score: number }>;
      humor: Array<{ tag: string; score: number }>;
      art: Array<{ tag: string; score: number }>;
      tone: Array<{ tag: string; score: number }>;
      topics: Array<{ tag: string; score: number }>;
    };
    topImageCategories: {
      themes: Array<{ tag: string; score: number }>;
      humor: Array<{ tag: string; score: number }>;
      art: Array<{ tag: string; score: number }>;
      tone: Array<{ tag: string; score: number }>;
      objects: Array<{ tag: string; score: number }>;
    };
  };
  activity: {
    postsTotal: number;
    postsByType: Array<{ type: ChatMessageType; count: number }>;
    postsWithImages: number;
    pollVotesGiven: number;
    pollsCreated: number;
    pollsExtended: number;
    aiMentions: { chatgpt: number; grok: number };
    activeDays: number;
    activityByWeekday: Array<{ weekday: number; count: number }>;
    activityByHour: Array<{ hour: number; count: number }>;
    tagging: {
      completed: number;
      failed: number;
      pending: number;
      coverage: number;
    };
  };
  social: {
    topInteractedUsers: Array<{
      userId: string;
      username: string;
      profilePicture: string;
      given: number;
      received: number;
      total: number;
    }>;
  };
}

export interface TasteProfileEventDTO {
  id: string;
  type: TasteProfileEventType;
  createdAt: string;
  messageId?: string;
  relatedUserId?: string;
  relatedUsername?: string;
  reaction?: ReactionType;
  preview?: string;
  meta?: Record<string, unknown>;
}

export interface TasteProfileEventPageDTO {
  items: TasteProfileEventDTO[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface LinkPreviewDTO {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  hostname: string;
}

export interface AiStatusDTO {
  chatgpt: string;
  grok: string;
  chatgptModel: string;
  grokModel: string;
  updatedAt: string;
}

export interface ChatBackgroundDTO {
  url: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface SnapshotDTO {
  users: UserPresenceDTO[];
  messages: MessageDTO[];
  aiStatus: AiStatusDTO;
  background: ChatBackgroundDTO;
  appKill: AppKillDTO;
}

export interface SseEventPayloadMap {
  snapshot: SnapshotDTO;
  "presence.updated": UserPresenceDTO;
  "message.created": MessageDTO;
  "message.updated": MessageDTO;
  "rank.up": {
    userId: string;
    clientId: string;
    username: string;
    previousRank: MemberRank;
    rank: MemberRank;
    score: number;
    createdAt: string;
  };
  "app.kill.updated": AppKillDTO;
  "taste.updated": {
    userId: string;
    updatedAt: string;
    reason: "message" | "reaction" | "poll" | "tagging";
  };
  "reaction.received": {
    targetUserId?: string;
    targetUsername: string;
    fromUsername: string;
    messageId: string;
    reaction: ReactionType;
    messagePreview: string;
    createdAt: string;
  };
  "notification.created": NotificationDTO;
  "notification.read": { userId: string; notificationIds?: string[] };
  "poll.updated": MessageDTO;
  "user.updated": UserPresenceDTO;
  "bot.updated": UserPresenceDTO;
  "bot.deleted": { clientId: string; botId: string };
  "chat.background.updated": ChatBackgroundDTO;
  "ai.status": { status: string; provider?: "chatgpt" | "grok"; model?: string };
}

export interface SseEnvelope<TEvent extends SseEventName = SseEventName> {
  id: string;
  event: TEvent;
  data: SseEventPayloadMap[TEvent];
}

export interface ApiErrorPayload {
  error: string;
}
