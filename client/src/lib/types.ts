export type ChatMessageType = "message" | "votingPoll" | "question" | "answer";

export type SseEventName =
  | "snapshot"
  | "presence.updated"
  | "message.created"
  | "poll.updated"
  | "user.updated"
  | "ai.status";

export interface LoginRequest {
  username: string;
  clientId: string;
  profilePicture?: string;
}

export interface LoginResponseDTO extends UserPresenceDTO {
  devMode: boolean;
  devAuthToken?: string;
}

export interface RenameUserRequest {
  clientId: string;
  newUsername?: string;
  profilePicture?: string;
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

export type AdminActionType =
  | "reset_all"
  | "delete_all_messages"
  | "logout_all_users"
  | "clear_blacklist"
  | "delete_user"
  | "delete_message";

export interface AdminOverviewRequest {
  clientId: string;
  devAuthToken: string;
}

export interface AdminActionRequest extends AdminOverviewRequest {
  action: AdminActionType;
  targetUsername?: string;
  targetMessageId?: string;
}

export interface AdminOverviewDTO {
  usersTotal: number;
  usersOnline: number;
  messagesTotal: number;
  pollsTotal: number;
  blacklistTotal: number;
}

export interface AdminActionResponse {
  ok: true;
  message: string;
  overview: AdminOverviewDTO;
}

export interface UserPresenceDTO {
  id: string;
  clientId: string;
  username: string;
  profilePicture: string;
  status: string;
  isOnline: boolean;
  lastSeenAt: string | null;
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

export interface LinkPreviewDTO {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  hostname: string;
}

export interface AiStatusDTO {
  status: string;
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
}

export interface SseEventPayloadMap {
  snapshot: SnapshotDTO;
  "presence.updated": UserPresenceDTO;
  "message.created": MessageDTO;
  "poll.updated": MessageDTO;
  "user.updated": UserPresenceDTO;
  "ai.status": { status: string };
}

export interface SseEnvelope<TEvent extends SseEventName = SseEventName> {
  id: string;
  event: TEvent;
  data: SseEventPayloadMap[TEvent];
}

export interface ApiErrorPayload {
  error: string;
}
