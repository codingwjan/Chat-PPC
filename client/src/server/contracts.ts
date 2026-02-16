import { z } from "zod";
import type {
  AdminActionRequest,
  AdminResetUserPasswordRequest,
  AdminOverviewRequest,
  AuthSignInRequest,
  AuthSignUpRequest,
  CreateMessageRequest,
  ExtendPollRequest,
  LoginRequest,
  MarkNotificationsReadRequest,
  PresencePingRequest,
  ReactMessageRequest,
  RenameUserRequest,
  TypingRequest,
  UpdateChatBackgroundRequest,
  UpdateOwnAccountRequest,
  VotePollRequest,
} from "@/lib/types";
import { AppError } from "@/server/errors";

const text = (field: string) =>
  z
    .string({ error: `${field} ist erforderlich` })
    .trim()
    .min(1, `${field} ist erforderlich`);

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isAppRelativePath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

function profilePictureUrl(field: string) {
  return z
    .string()
    .trim()
    .refine((value) => !value.toLowerCase().startsWith("data:"), {
      message: `${field} darf keine data-URL sein`,
    })
    .refine((value) => isAbsoluteUrl(value) || isAppRelativePath(value), {
      message: `${field} muss eine gültige URL sein`,
    });
}

function externalUrl(field: string) {
  return z
    .string()
    .trim()
    .url(`${field} muss eine gültige URL sein`)
    .refine((value) => !value.toLowerCase().startsWith("data:"), {
      message: `${field} darf keine data-URL sein`,
    });
}

const loginSchema = z.object({
  clientId: text("clientId"),
  sessionToken: text("sessionToken"),
});

const authSignUpSchema = z.object({
  loginName: text("loginName")
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, "loginName muss 3-32 Zeichen haben (a-z, 0-9, ., _, -)"),
  password: text("password").min(8, "password muss mindestens 8 Zeichen lang sein"),
  displayName: text("displayName").min(3, "displayName muss mindestens 3 Zeichen lang sein"),
  profilePicture: profilePictureUrl("profilePicture").optional(),
});

const authSignInSchema = z.object({
  loginName: text("loginName")
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, "loginName muss 3-32 Zeichen haben (a-z, 0-9, ., _, -)"),
  password: text("password").min(8, "password muss mindestens 8 Zeichen lang sein"),
});

const renameSchema = z.object({
  clientId: text("clientId"),
  newUsername: z
    .string()
    .trim()
    .min(3, "newUsername muss mindestens 3 Zeichen lang sein")
    .optional(),
  profilePicture: profilePictureUrl("profilePicture").optional(),
}).superRefine((value, ctx) => {
  if (!value.newUsername && !value.profilePicture) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Entweder newUsername oder profilePicture ist erforderlich",
      path: ["newUsername"],
    });
  }
});

const updateOwnAccountSchema = z.object({
  clientId: text("clientId"),
  currentPassword: text("currentPassword").min(8, "currentPassword muss mindestens 8 Zeichen lang sein"),
  newLoginName: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, "newLoginName muss 3-32 Zeichen haben (a-z, 0-9, ., _, -)")
    .optional(),
  newPassword: text("newPassword").min(8, "newPassword muss mindestens 8 Zeichen lang sein").optional(),
}).superRefine((value, ctx) => {
  if (!value.newLoginName && !value.newPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Entweder newLoginName oder newPassword ist erforderlich",
      path: ["newLoginName"],
    });
  }
});

const presencePingSchema = z.object({
  clientId: text("clientId"),
});

const typingSchema = z.object({
  clientId: text("clientId"),
  status: z.string().max(128),
});

const chatBackgroundSchema = z.object({
  clientId: text("clientId"),
  url: z
    .union([externalUrl("url"), z.literal(""), z.null()])
    .optional(),
});

const createMessageSchema = z
  .object({
    clientId: text("clientId"),
    type: z.enum(["message", "votingPoll", "question", "answer"]),
    message: z.string().trim(),
    optionOne: z.string().trim().optional(),
    optionTwo: z.string().trim().optional(),
    pollOptions: z.array(z.string().trim().min(1)).max(15).optional(),
    pollMultiSelect: z.boolean().optional(),
    pollAllowVoteChange: z.boolean().optional(),
    questionId: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "message ist erforderlich",
        path: ["message"],
      });
    }

    if (value.type === "votingPoll") {
      const options = value.pollOptions?.map((option) => option.trim()).filter(Boolean) ?? [];

      if (options.length > 15) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "pollOptions unterstützt maximal 15 Optionen",
          path: ["pollOptions"],
        });
      }

      if (options.length < 2 && !value.optionOne) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Mindestens zwei Umfrageoptionen sind erforderlich",
          path: ["optionOne"],
        });
      }

      if (options.length < 2 && !value.optionTwo) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Mindestens zwei Umfrageoptionen sind erforderlich",
          path: ["optionTwo"],
        });
      }
    }

    if (value.type === "answer" && !value.questionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "questionId ist für Antworten erforderlich",
        path: ["questionId"],
      });
    }
  });

const votePollSchema = z.object({
  clientId: text("clientId"),
  pollMessageId: text("pollMessageId"),
  side: z.enum(["left", "right"]).optional(),
  optionIds: z.array(text("optionIds[]")).max(15).optional(),
}).superRefine((value, ctx) => {
  if (!value.side && (!value.optionIds || value.optionIds.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Entweder side oder optionIds ist erforderlich",
      path: ["optionIds"],
    });
  }
});

const extendPollSchema = z.object({
  clientId: text("clientId"),
  pollMessageId: text("pollMessageId"),
  pollOptions: z
    .array(text("pollOptions[]"))
    .min(1, "Mindestens eine Umfrageoption ist erforderlich")
    .max(15, "Umfragen unterstützen bis zu 15 neue Optionen"),
});

const reactMessageSchema = z.object({
  clientId: text("clientId"),
  messageId: text("messageId"),
  reaction: z.enum(["LIKE", "LOL", "FIRE", "BASED", "WTF", "BIG_BRAIN"]),
});

const markNotificationsReadSchema = z.object({
  clientId: text("clientId"),
  notificationIds: z.array(text("notificationIds[]")).max(100).optional(),
});

const tasteProfileQuerySchema = z.object({
  clientId: text("clientId"),
});

const publicUserProfileQuerySchema = z.object({
  viewerClientId: text("viewerClientId"),
  targetClientId: text("targetClientId"),
});

const tasteEventsQuerySchema = z.object({
  clientId: text("clientId"),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.string().trim().optional(),
});

const adminOverviewSchema = z.object({
  clientId: text("clientId"),
  devAuthToken: text("devAuthToken"),
});

const adminTasteQuerySchema = adminOverviewSchema.extend({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const adminActionSchema = adminOverviewSchema
  .extend({
    action: z.enum([
      "reset_all",
      "delete_all_messages",
      "logout_all_users",
      "clear_blacklist",
      "delete_user",
      "delete_message",
    ]),
    targetUsername: z.string().trim().optional(),
    targetMessageId: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "delete_user" && !value.targetUsername) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "targetUsername ist für delete_user erforderlich",
        path: ["targetUsername"],
      });
    }

    if (value.action === "delete_message" && !value.targetMessageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "targetMessageId ist für delete_message erforderlich",
        path: ["targetMessageId"],
      });
    }
  });

const adminResetUserPasswordSchema = adminOverviewSchema.extend({
  targetUserId: text("targetUserId"),
  newPassword: text("newPassword").min(8, "newPassword muss mindestens 8 Zeichen lang sein"),
});

function parseOrThrow<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? "Ungültige Anfrage", 400);
  }

  return parsed.data;
}

export function parseLoginRequest(payload: unknown): LoginRequest {
  return parseOrThrow(loginSchema, payload);
}

export function parseAuthSignUpRequest(payload: unknown): AuthSignUpRequest {
  return parseOrThrow(authSignUpSchema, payload);
}

export function parseAuthSignInRequest(payload: unknown): AuthSignInRequest {
  return parseOrThrow(authSignInSchema, payload);
}

export function parseRenameUserRequest(payload: unknown): RenameUserRequest {
  return parseOrThrow(renameSchema, payload);
}

export function parseUpdateOwnAccountRequest(payload: unknown): UpdateOwnAccountRequest {
  return parseOrThrow(updateOwnAccountSchema, payload);
}

export function parsePresencePingRequest(payload: unknown): PresencePingRequest {
  return parseOrThrow(presencePingSchema, payload);
}

export function parseTypingRequest(payload: unknown): TypingRequest {
  return parseOrThrow(typingSchema, payload);
}

export function parseUpdateChatBackgroundRequest(payload: unknown): UpdateChatBackgroundRequest {
  return parseOrThrow(chatBackgroundSchema, payload);
}

export function parseCreateMessageRequest(payload: unknown): CreateMessageRequest {
  return parseOrThrow(createMessageSchema, payload);
}

export function parseVotePollRequest(payload: unknown): VotePollRequest {
  return parseOrThrow(votePollSchema, payload);
}

export function parseExtendPollRequest(payload: unknown): ExtendPollRequest {
  return parseOrThrow(extendPollSchema, payload);
}

export function parseReactMessageRequest(payload: unknown): ReactMessageRequest {
  return parseOrThrow(reactMessageSchema, payload);
}

export function parseMarkNotificationsReadRequest(payload: unknown): MarkNotificationsReadRequest {
  return parseOrThrow(markNotificationsReadSchema, payload);
}

export function parseTasteProfileQueryRequest(payload: unknown): { clientId: string } {
  return parseOrThrow(tasteProfileQuerySchema, payload);
}

export function parsePublicUserProfileQueryRequest(payload: unknown): {
  viewerClientId: string;
  targetClientId: string;
} {
  return parseOrThrow(publicUserProfileQuerySchema, payload);
}

export function parseTasteEventsQueryRequest(payload: unknown): {
  clientId: string;
  limit?: number;
  before?: string;
} {
  return parseOrThrow(tasteEventsQuerySchema, payload);
}

export function parseAdminOverviewRequest(payload: unknown): AdminOverviewRequest {
  return parseOrThrow(adminOverviewSchema, payload);
}

export function parseAdminTasteQueryRequest(payload: unknown): {
  clientId: string;
  devAuthToken: string;
  limit?: number;
} {
  return parseOrThrow(adminTasteQuerySchema, payload);
}

export function parseAdminActionRequest(payload: unknown): AdminActionRequest {
  return parseOrThrow(adminActionSchema, payload);
}

export function parseAdminUsersQueryRequest(payload: unknown): AdminOverviewRequest {
  return parseOrThrow(adminOverviewSchema, payload);
}

export function parseAdminResetUserPasswordRequest(payload: unknown): AdminResetUserPasswordRequest {
  return parseOrThrow(adminResetUserPasswordSchema, payload);
}
