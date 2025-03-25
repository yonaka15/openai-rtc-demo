import {
  WorkerMessage,
  MainToWorkerMessage,
  WorkerToMainMessage,
} from "./types";

const log = (message: string) => {
  self.postMessage({
    type: "DEBUG_LOG",
    data: `${new Date().toISOString()}: ${message}`,
  });
};

// Get session token
const getSessionToken = async () => {
  try {
    log("Requesting session token...");
    const tokenResponse = await fetch(`${self.location.origin}/api/session`);
    const data = await tokenResponse.json();

    if (!data.client_secret?.value) {
      throw new Error("Failed to get valid session token");
    }

    log("Received session token");
    return data.client_secret.value;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to get session token";
    log(`Error: ${errorMessage}`);
    throw error;
  }
};

// Get remote description
const getRemoteDescription = async (offer: string, token: string) => {
  log("Getting remote description...");
  const baseUrl = "https://api.openai.com/v1/realtime";
  const model = "gpt-4o-mini-realtime-preview-2024-12-17";

  log(`Making request to: ${baseUrl}?model=${model}`);
  log(`Using offer SDP: ${offer.slice(0, 100)}...`);

  const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
    method: "POST",
    body: offer,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/sdp",
    },
  });

  if (!sdpResponse.ok) {
    const responseText = await sdpResponse.text();
    log(`Response error (${sdpResponse.status}): ${responseText}`);
    throw new Error(
      `Failed to get remote description: ${sdpResponse.status} - ${responseText}`
    );
  }

  log("Response is OK, getting SDP answer...");

  if (!sdpResponse.ok) {
    throw new Error(`Failed to get remote description: ${sdpResponse.status}`);
  }

  log("Received answer from OpenAI");
  return await sdpResponse.text();
};

// Format outgoing messages
const formatUserMessage = (message: string) => {
  return {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: message,
        },
      ],
    },
  };
};

/**
 * ツール（関数）のパラメータに関する型定義
 */
type ToolParameter = {
  /** パラメータの型 */
  type: string;
  /** パラメータのプロパティ */
  properties?: Record<
    string,
    {
      type: string;
      description?: string;
      enum?: string[];
      [key: string]: any;
    }
  >;
  /** 必須パラメータのリスト */
  required?: string[];
  /** その他の追加プロパティ */
  [key: string]: any;
};

/**
 * ツール（関数）の定義に関する型定義
 */
type Tool = {
  /** ツールのタイプ - 通常は "function" */
  type: "function";
  /** 関数の名前 */
  name: string;
  /** 関数の説明 */
  description: string;
  /** 関数のパラメータ */
  parameters: ToolParameter;
};

/**
 * レスポンス要求のオプション型定義
 */
type ResponseRequestOptions = {
  /** 応答のモダリティ ["text"], ["audio"], または ["text", "audio"] */
  modalities?: Array<"text" | "audio">;
  /** 音声タイプ (audio モダリティを使用する場合) */
  voice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" | "verse";
  /** この特定のレスポンスに対する追加指示 */
  instructions?: string;
  /** 応答のランダム性 (0.0〜2.0) */
  temperature?: number;
  /** 応答の最大トークン数 */
  maxOutputTokens?: number;
  /** レスポンス追跡用の一意のID */
  eventId?: string;
  /** 使用可能なツール（関数）のリスト */
  tools?: Tool[];
  /** ツール選択方法 - "auto", "none", または特定の関数名 */
  toolChoice?:
    | "auto"
    | "none"
    | { type: "function"; function: { name: string } };
};

/**
 * レスポンス要求のフォーマット結果の型定義
 */
type ResponseRequestResult = {
  type: "response.create";
  event_id?: string;
  response: {
    modalities: Array<"text" | "audio">;
    voice?: string;
    output_audio_format?: string;
    instructions?: string;
    temperature?: number;
    max_output_tokens?: number;
    tools?: Tool[];
    tool_choice?:
      | "auto"
      | "none"
      | { type: "function"; function: { name: string } };
  };
};

/**
 * レスポンス要求の拡張フォーマット関数
 * @param options - レスポンス設定オプション
 * @returns フォーマットされたレスポンスリクエストオブジェクト
 */
const formatResponseRequest = (
  options: ResponseRequestOptions = {}
): ResponseRequestResult => {
  const {
    modalities = ["text"],
    voice = "verse",
    instructions,
    temperature,
    maxOutputTokens,
    eventId,
    tools,
    toolChoice,
  } = options;

  // 基本的なレスポンスオブジェクトを作成
  const response: ResponseRequestResult = {
    type: "response.create",
    response: {
      modalities: modalities,
    },
  };

  // オプションのイベントIDが提供されている場合は追加
  if (eventId) {
    response.event_id = eventId;
  }

  // オーディオモダリティが含まれている場合は音声設定を追加
  if (modalities.includes("audio")) {
    response.response.voice = voice;
    response.response.output_audio_format = "pcm16"; // デフォルトのオーディオフォーマット
  }

  // 追加指示が提供されている場合は追加
  if (instructions) {
    response.response.instructions = instructions;
  }

  // 温度設定が提供されている場合は追加
  if (temperature !== undefined) {
    response.response.temperature = temperature;
  }

  // 最大出力トークン設定が提供されている場合は追加
  if (maxOutputTokens !== undefined) {
    response.response.max_output_tokens = maxOutputTokens;
  }

  // ツール（関数）が提供されている場合は追加
  if (tools && tools.length > 0) {
    response.response.tools = tools;
  }

  // ツール選択方法が提供されている場合は追加
  if (toolChoice !== undefined) {
    response.response.tool_choice = toolChoice;
  }

  return response;
};

// Handle messages from main thread
self.onmessage = async (event: MessageEvent<MainToWorkerMessage>) => {
  const { type, data } = event.data;

  try {
    switch (type) {
      case "INIT_CONNECTION":
        const token = await getSessionToken();
        self.postMessage({
          type: "TOKEN_RECEIVED",
          data: { token },
        });
        break;

      case "GET_REMOTE_DESCRIPTION":
        if (typeof data?.content === "string") {
          const answer = await getRemoteDescription(
            data.content,
            data.token as string
          );
          self.postMessage({
            type: "REMOTE_DESCRIPTION_RECEIVED",
            data: { sdp: answer },
          });
        }
        break;

      case "FORMAT_MESSAGE":
        if (typeof data?.content === "string") {
          const userMessage = formatUserMessage(data.content);
          const responseRequest = formatResponseRequest();
          self.postMessage({
            type: "MESSAGE_FORMATTED",
            data: {
              userMessage,
              responseRequest,
            },
          });
        }
        break;

      default:
        log(`Unknown message type: ${type}`);
    }
  } catch (error) {
    self.postMessage({
      type: "ERROR",
      error: error instanceof Error ? error.message : "Unknown error occurred",
    });
  }
};
