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

const formatResponseRequest = () => {
  return {
    type: "response.create",
    response: {
      modalities: ["text"],
    },
  };
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
