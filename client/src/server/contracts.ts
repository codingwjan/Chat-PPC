import { z } from "zod";
import type {
  CreateMessageRequest,
  LoginRequest,
  PresencePingRequest,
  RenameUserRequest,
  TypingRequest,
  VotePollRequest,
} from "@/lib/types";
import { AppError } from "@/server/errors";

const text = (field: string) =>
  z
    .string({ error: `${field} is required` })
    .trim()
    .min(1, `${field} is required`);

const loginSchema = z.object({
  username: text("username").min(3, "username must be at least 3 characters"),
  clientId: text("clientId"),
  profilePicture: z.string().url().optional(),
});

const renameSchema = z.object({
  clientId: text("clientId"),
  newUsername: z
    .string()
    .trim()
    .min(3, "newUsername must be at least 3 characters")
    .optional(),
  profilePicture: z.string().url("profilePicture must be a valid URL").optional(),
}).superRefine((value, ctx) => {
  if (!value.newUsername && !value.profilePicture) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Either newUsername or profilePicture is required",
      path: ["newUsername"],
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

const createMessageSchema = z
  .object({
    clientId: text("clientId"),
    type: z.enum(["message", "votingPoll", "question", "answer"]),
    message: z.string().trim(),
    optionOne: z.string().trim().optional(),
    optionTwo: z.string().trim().optional(),
    questionId: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "message is required",
        path: ["message"],
      });
    }

    if (value.type === "votingPoll") {
      if (!value.optionOne) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "optionOne is required for votingPoll",
          path: ["optionOne"],
        });
      }

      if (!value.optionTwo) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "optionTwo is required for votingPoll",
          path: ["optionTwo"],
        });
      }
    }

    if (value.type === "answer" && !value.questionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "questionId is required for answer",
        path: ["questionId"],
      });
    }
  });

const votePollSchema = z.object({
  clientId: text("clientId"),
  pollMessageId: text("pollMessageId"),
  side: z.enum(["left", "right"]),
});

function parseOrThrow<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request", 400);
  }

  return parsed.data;
}

export function parseLoginRequest(payload: unknown): LoginRequest {
  return parseOrThrow(loginSchema, payload);
}

export function parseRenameUserRequest(payload: unknown): RenameUserRequest {
  return parseOrThrow(renameSchema, payload);
}

export function parsePresencePingRequest(payload: unknown): PresencePingRequest {
  return parseOrThrow(presencePingSchema, payload);
}

export function parseTypingRequest(payload: unknown): TypingRequest {
  return parseOrThrow(typingSchema, payload);
}

export function parseCreateMessageRequest(payload: unknown): CreateMessageRequest {
  return parseOrThrow(createMessageSchema, payload);
}

export function parseVotePollRequest(payload: unknown): VotePollRequest {
  return parseOrThrow(votePollSchema, payload);
}
