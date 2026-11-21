import type {
  JsonSchemaDefinition,
  LlmMessageContent,
  ResponseMode,
} from "../types";
import { buildHeaders, joinUrl } from "../utils/http";
import { getNestedValue } from "../utils/object";
import { createProviderStrategy } from "./factory";

type NativeMessage = {
  role: "user" | "system" | "assistant";
  content: LlmMessageContent;
};

/**
 * Ollama's OpenAI-compatible endpoint ignores `think: false` for reasoning
 * models such as qwen3, which makes short structured requests take 50-80s.
 * The native chat endpoint honours it, dropping the same requests to ~10s.
 */
function shouldDisableThinking(model: string): boolean {
  return (
    /(?:^|[/:])qwen3\b/i.test(model) || /(?:^|[/:])deepseek-r1\b/i.test(model)
  );
}

function toNativeMessages(messages: NativeMessage[]) {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return { role: message.role, content: message.content };
    }

    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");
    const images = message.content
      .filter((part) => part.type === "image")
      .map((part) =>
        part.type === "image"
          ? part.imageUrl.replace(/^data:[^;]+;base64,/, "")
          : "",
      )
      .filter(Boolean);

    return {
      role: message.role,
      content: text,
      ...(images.length > 0 ? { images } : {}),
    };
  });
}

function buildNativeBody(args: {
  mode: ResponseMode;
  model: string;
  messages: NativeMessage[];
  jsonSchema: JsonSchemaDefinition;
}) {
  const { mode, model, messages, jsonSchema } = args;
  const format =
    mode === "json_schema"
      ? jsonSchema.schema
      : mode === "json_object"
        ? "json"
        : undefined;

  return {
    model,
    messages: toNativeMessages(messages),
    stream: false,
    ...(format !== undefined ? { format } : {}),
    ...(shouldDisableThinking(model) ? { think: false } : {}),
  };
}

export const ollamaStrategy = createProviderStrategy({
  provider: "ollama",
  defaultBaseUrl: "http://localhost:11434",
  requiresApiKey: false,
  modes: ["json_schema", "text", "none"],
  validationPaths: ["/v1/models", "/api/tags"],
  buildRequest: ({ mode, baseUrl, apiKey, model, messages, jsonSchema }) => {
    return {
      url: joinUrl(baseUrl, "/api/chat"),
      headers: buildHeaders({ apiKey, provider: "ollama" }),
      body: buildNativeBody({ mode, model, messages, jsonSchema }),
    };
  },
  extractText: (response) => {
    const content = getNestedValue(response, ["message", "content"]);
    return typeof content === "string" ? content : null;
  },
});
