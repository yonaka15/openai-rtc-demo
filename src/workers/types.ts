// Message types that can be sent to/from the worker
export type WorkerMessageType =
  | "INIT_CONNECTION"
  | "TOKEN_RECEIVED"
  | "GET_REMOTE_DESCRIPTION"
  | "REMOTE_DESCRIPTION_RECEIVED"
  | "FORMAT_MESSAGE"
  | "MESSAGE_FORMATTED"
  | "FUNCTION_CALL"        // 追加: function callを処理
  | "FUNCTION_RESULT"      // 追加: function resultを処理
  | "SEND_TO_DATA_CHANNEL" // 追加: データチャネルにメッセージを送信
  | "ERROR"
  | "DEBUG_LOG";

// Base message structure
export interface WorkerMessage {
  type: WorkerMessageType;
  data?: any;
  error?: string;
}

// Messages that can be sent to the worker
export interface MainToWorkerMessage {
  type: WorkerMessageType;
  data?: {
    content?: string;
    token?: string;
    timestamp?: Date;
    functionResult?: any;  // 追加: 関数実行結果
  };
}

// Messages that can be sent from the worker
export interface WorkerToMainMessage {
  type: WorkerMessageType;
  data?: {
    token?: string;
    sdp?: string;
    content?: string;
    userMessage?: any;
    responseRequest?: any;
    functionCall?: any;    // 追加: function callデータ
    message?: any;         // 追加: データチャネルに送信するメッセージ
    timestamp?: Date;
  };
  error?: string;
}
