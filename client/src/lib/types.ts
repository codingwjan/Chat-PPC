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
    }>;
    settings: {
      multiSelect: boolean;
      allowVoteChange: boolean;
    };
  };
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
