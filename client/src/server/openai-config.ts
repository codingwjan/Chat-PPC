type WebSearchContextSize = "low" | "medium" | "high";
type ImageBackground = "auto" | "opaque" | "transparent";
type ImageModeration = "low" | "auto";
type ImageOutputFormat = "png" | "jpeg" | "webp";
type ImageQuality = "auto" | "low" | "medium" | "high";
type ImageSize = "auto" | "1024x1024" | "1024x1536" | "1536x1024";

export interface ChatOpenAiConfig {
  promptId: string;
  promptVersion: string;
  fallbackModel: string;
  lowLatencyMode: boolean;
  store: boolean;
  includeEncryptedReasoning: boolean;
  includeWebSources: boolean;
  webSearch: {
    enabled: boolean;
    country: string;
    region: string;
    city: string;
    contextSize: WebSearchContextSize;
  };
  imageGeneration: {
    enabled: boolean;
    model: string;
    background: ImageBackground;
    moderation: ImageModeration;
    outputCompression: number;
    outputFormat: ImageOutputFormat;
    quality: ImageQuality;
    size: ImageSize;
  };
}

const DEFAULTS = {
  promptId: "pmpt_698b4aee21308196b860d14abc12b51d0f2e06f804bcc0ca",
  promptVersion: "4",
  fallbackModel: "gpt-4o-mini",
  lowLatencyMode: true,
  store: true,
  includeEncryptedReasoning: true,
  includeWebSources: true,
  webSearch: {
    enabled: true,
    country: "DE",
    region: "Hessen",
    city: "Limburg",
    contextSize: "low" as WebSearchContextSize,
  },
  imageGeneration: {
    enabled: false,
    model: "gpt-image-1-mini",
    background: "auto" as ImageBackground,
    moderation: "low" as ImageModeration,
    outputCompression: 100,
    outputFormat: "png" as ImageOutputFormat,
    quality: "auto" as ImageQuality,
    size: "auto" as ImageSize,
  },
};

function getEnv(key: string): string | undefined {
  const value = process.env[key];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseBoolean(key: string, fallback: boolean): boolean {
  const value = getEnv(key);
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  return fallback;
}

function parseNumber(key: string, fallback: number): number {
  const value = getEnv(key);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function parseEnum<TValue extends string>(
  key: string,
  allowed: readonly TValue[],
  fallback: TValue,
): TValue {
  const value = getEnv(key);
  if (!value) return fallback;
  const normalized = value.toLowerCase() as TValue;
  return allowed.includes(normalized) ? normalized : fallback;
}

export function getChatOpenAiConfig(): ChatOpenAiConfig {
  const promptId = getEnv("OPENAI_PROMPT_ID") ?? DEFAULTS.promptId;

  return {
    promptId,
    promptVersion: getEnv("OPENAI_PROMPT_VERSION") ?? DEFAULTS.promptVersion,
    fallbackModel: getEnv("OPENAI_MODEL") ?? DEFAULTS.fallbackModel,
    lowLatencyMode: parseBoolean("OPENAI_LOW_LATENCY_MODE", DEFAULTS.lowLatencyMode),
    store: parseBoolean("OPENAI_STORE_RESPONSES", DEFAULTS.store),
    includeEncryptedReasoning: parseBoolean(
      "OPENAI_INCLUDE_REASONING_ENCRYPTED",
      DEFAULTS.includeEncryptedReasoning,
    ),
    includeWebSources: parseBoolean("OPENAI_INCLUDE_WEB_SOURCES", DEFAULTS.includeWebSources),
    webSearch: {
      enabled: parseBoolean("OPENAI_ENABLE_WEB_SEARCH", DEFAULTS.webSearch.enabled),
      country: getEnv("OPENAI_WEB_SEARCH_COUNTRY") ?? DEFAULTS.webSearch.country,
      region: getEnv("OPENAI_WEB_SEARCH_REGION") ?? DEFAULTS.webSearch.region,
      city: getEnv("OPENAI_WEB_SEARCH_CITY") ?? DEFAULTS.webSearch.city,
      contextSize: parseEnum(
        "OPENAI_WEB_SEARCH_CONTEXT_SIZE",
        ["low", "medium", "high"] as const,
        DEFAULTS.webSearch.contextSize,
      ),
    },
    imageGeneration: {
      enabled: parseBoolean("OPENAI_ENABLE_IMAGE_GENERATION", DEFAULTS.imageGeneration.enabled),
      model: getEnv("OPENAI_IMAGE_MODEL") ?? DEFAULTS.imageGeneration.model,
      background: parseEnum(
        "OPENAI_IMAGE_BACKGROUND",
        ["auto", "opaque", "transparent"] as const,
        DEFAULTS.imageGeneration.background,
      ),
      moderation: parseEnum(
        "OPENAI_IMAGE_MODERATION",
        ["low", "auto"] as const,
        DEFAULTS.imageGeneration.moderation,
      ),
      outputCompression: Math.min(
        100,
        Math.max(0, parseNumber("OPENAI_IMAGE_OUTPUT_COMPRESSION", DEFAULTS.imageGeneration.outputCompression)),
      ),
      outputFormat: parseEnum(
        "OPENAI_IMAGE_OUTPUT_FORMAT",
        ["png", "jpeg", "webp"] as const,
        DEFAULTS.imageGeneration.outputFormat,
      ),
      quality: parseEnum(
        "OPENAI_IMAGE_QUALITY",
        ["auto", "low", "medium", "high"] as const,
        DEFAULTS.imageGeneration.quality,
      ),
      size: parseEnum(
        "OPENAI_IMAGE_SIZE",
        ["auto", "1024x1024", "1024x1536", "1536x1024"] as const,
        DEFAULTS.imageGeneration.size,
      ),
    },
  };
}
