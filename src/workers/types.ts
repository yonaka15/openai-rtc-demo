// Message types that can be sent to/from the worker
export type WorkerMessageType =
  | "INIT_CONNECTION"
  | "TOKEN_RECEIVED"
  | "GET_REMOTE_DESCRIPTION"
  | "REMOTE_DESCRIPTION_RECEIVED"
  | "FORMAT_MESSAGE"
  | "MESSAGE_FORMATTED"
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
    timestamp?: Date;
  };
  error?: string;
}
