"use client";

import { useEffect, useRef, useState } from "react";

interface Message {
  role: "assistant" | "user";
  content: string;
  timestamp: Date;
}

const WebRTCClient = () => {
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [status, setStatus] = useState("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [isDataChannelReady, setIsDataChannelReady] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Debug logging helper
  const addDebugLog = (message: string) => {
    console.log(message); // Also log to console
    setDebugLog((prev) => [...prev, `${new Date().toISOString()}: ${message}`]);
  };

  useEffect(() => {
    initializeWebRTC();
    return () => {
      // Cleanup on unmount
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      if (dataChannelRef.current) {
        dataChannelRef.current.close();
      }
    };
  }, []);

  const initializeWebRTC = async () => {
    try {
      // Get session token
      setStatus("Getting session token...");
      addDebugLog("Requesting session token...");
      const tokenResponse = await fetch("/api/session");
      const data = await tokenResponse.json();

      if (!data.client_secret?.value) {
        throw new Error("Failed to get valid session token");
      }

      addDebugLog("Received session token");
      const EPHEMERAL_KEY = data.client_secret.value;
      setStatus("Creating peer connection...");

      // Create peer connection
      const pc = new RTCPeerConnection();
      peerConnectionRef.current = pc;
      addDebugLog("Peer connection created");

      // Connection state monitoring
      pc.onconnectionstatechange = () => {
        addDebugLog(`Connection state changed to: ${pc.connectionState}`);
      };

      pc.oniceconnectionstatechange = () => {
        addDebugLog(
          `ICE connection state changed to: ${pc.iceConnectionState}`
        );
      };

      pc.onicegatheringstatechange = () => {
        addDebugLog(`ICE gathering state changed to: ${pc.iceGatheringState}`);
      };

      pc.onicecandidate = (event) => {
        addDebugLog(`ICE candidate: ${event.candidate ? "received" : "null"}`);
      };

      // Set up audio element
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;

      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
        addDebugLog("Received remote audio track");
        setStatus("Received remote audio track");
      };

      // Add local audio track
      setStatus("Getting microphone access...");
      addDebugLog("Requesting microphone access...");
      const ms = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      pc.addTrack(ms.getTracks()[0]);
      addDebugLog("Local audio track added");

      // Set up data channel
      setStatus("Setting up data channel...");
      addDebugLog("Creating data channel...");
      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;

      // Add data channel event listeners
      dc.onopen = () => {
        addDebugLog("Data channel opened");
        setIsDataChannelReady(true);
        setStatus("Data channel opened");
      };

      dc.onclose = () => {
        addDebugLog("Data channel closed");
        setIsDataChannelReady(false);
        setStatus("Data channel closed");
      };

      dc.onerror = (error) => {
        addDebugLog(`Data channel error: ${error.toString()}`);
        setError("Data channel error occurred");
      };

      dc.addEventListener("message", (e) => {
        try {
          const realtimeEvent = JSON.parse(e.data);
          addDebugLog(`Received event: ${JSON.stringify(realtimeEvent)}`);

          // Handle text delta events
          if (realtimeEvent.type === "response.text.delta") {
            setMessages((prev) => {
              const lastMessage = prev[prev.length - 1];
              if (lastMessage?.role === "assistant") {
                return [
                  ...prev.slice(0, -1),
                  {
                    ...lastMessage,
                    content: lastMessage.content + realtimeEvent.delta,
                  },
                ];
              } else {
                return [
                  ...prev,
                  {
                    role: "assistant",
                    content: realtimeEvent.delta,
                    timestamp: new Date(),
                  },
                ];
              }
            });
          }
        } catch (error) {
          addDebugLog(`Error parsing event: ${error}`);
        }
      });

      // Create and set local description
      setStatus("Creating offer...");
      addDebugLog("Creating offer...");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      addDebugLog("Local description set");

      // Get remote description
      setStatus("Getting remote description...");
      addDebugLog("Sending offer to OpenAI...");
      const baseUrl = "https://api.openai.com/v1/realtime";
      const model = "gpt-4o-realtime-preview-2024-12-17";
      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResponse.ok) {
        throw new Error(
          `Failed to get remote description: ${sdpResponse.status}`
        );
      }

      addDebugLog("Received answer from OpenAI");
      const answer: RTCSessionDescriptionInit = {
        type: "answer",
        sdp: await sdpResponse.text(),
      };

      // Set remote description
      await pc.setRemoteDescription(answer);
      addDebugLog("Remote description set");
      setStatus("Connection established");
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to initialize WebRTC";
      addDebugLog(`Error: ${errorMessage}`);
      console.error("WebRTC initialization failed:", err);
      setError(errorMessage);
      setStatus("Failed");
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim()) return;

    if (
      !dataChannelRef.current ||
      dataChannelRef.current.readyState !== "open"
    ) {
      const stateMessage = `Data channel not ready. Current state: ${dataChannelRef.current?.readyState}`;
      addDebugLog(stateMessage);
      console.error(stateMessage);
      return;
    }

    // Send user message
    const userMessage = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: inputMessage,
          },
        ],
      },
    };

    try {
      // Send user message
      addDebugLog(`Sending message: ${JSON.stringify(userMessage)}`);
      dataChannelRef.current.send(JSON.stringify(userMessage));
      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: inputMessage,
          timestamp: new Date(),
        },
      ]);

      // Wait a bit for the message to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Request response from the model
      const responseRequest = {
        type: "response.create",
        response: {
          modalities: ["text"],
        },
      };

      addDebugLog(`Requesting response: ${JSON.stringify(responseRequest)}`);
      dataChannelRef.current.send(JSON.stringify(responseRequest));

      setInputMessage("");
      addDebugLog("Message and response request sent successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to send message";
      addDebugLog(`Error sending message: ${errorMessage}`);
      console.error("Failed to send message:", error);
      setError(errorMessage);
    }
  };

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="mb-4">
        <h2 className="text-xl font-semibold mb-2">WebRTC Status</h2>
        <p
          className={`${
            status === "Failed" ? "text-red-500" : "text-blue-500"
          }`}
        >
          {status}
        </p>
        <p
          className={`${
            isDataChannelReady ? "text-green-500" : "text-yellow-500"
          }`}
        >
          Data Channel: {isDataChannelReady ? "Ready" : "Not Ready"}
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
          <p className="text-red-600">{error}</p>
        </div>
      )}

      {/* Chat Messages */}
      <div className="border rounded-lg mb-4 h-96 overflow-y-auto p-4 bg-gray-50">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`mb-4 ${
              msg.role === "user" ? "text-right" : "text-left"
            }`}
          >
            <div
              className={`inline-block max-w-[70%] rounded-lg px-4 py-2 ${
                msg.role === "user"
                  ? "bg-blue-500 text-white"
                  : "bg-white border"
              }`}
            >
              <p>{msg.content}</p>
              <p className="text-xs mt-1 opacity-50">
                {msg.timestamp.toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyPress={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Type a message..."
          className="flex-1 border rounded-md px-4 py-2"
          disabled={!isDataChannelReady}
        />
        <button
          onClick={sendMessage}
          disabled={!isDataChannelReady || !inputMessage.trim()}
          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>

      {/* Debug Log */}
      <div className="mt-4">
        <h3 className="text-lg font-semibold mb-2">Debug Log</h3>
        <div className="bg-gray-100 p-4 rounded-md max-h-48 overflow-y-auto">
          {debugLog.map((log, index) => (
            <p key={index} className="text-sm font-mono mb-1">
              {log}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
};

export default WebRTCClient;
