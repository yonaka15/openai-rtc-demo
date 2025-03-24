"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkerToMainMessage } from "../workers/types";

interface Message {
  role: "assistant" | "user";
  content: string;
  timestamp: Date;
}

const WebRTCClient = () => {
  const workerRef = useRef<Worker | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [status, setStatus] = useState("Disconnected");
  const [error, setError] = useState<string | null>(null);
  const [isDataChannelReady, setIsDataChannelReady] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const debugLogEndRef = useRef<HTMLDivElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    // For chat messages
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const scrollDebugToBottom = () => {
    const debugLogContainer = debugLogEndRef.current?.parentElement;
    if (debugLogContainer) {
      debugLogContainer.scrollTop = debugLogContainer.scrollHeight;
    }
  };

  const scrollTranscriptToBottom = () => {
    const transcriptContainer = transcriptEndRef.current?.parentElement;
    if (transcriptContainer) {
      transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    scrollDebugToBottom();
  }, [debugLog]);

  useEffect(() => {
    scrollTranscriptToBottom();
  }, [transcripts]);

  // Add debug log with auto scroll
  const addDebugLog = (message: string) => {
    console.log(message);
    setDebugLog((prev) => [...prev, `${new Date().toISOString()}: ${message}`]);
  };

  // Add transcript handling function
  const addTranscript = (text: string) => {
    setTranscripts((prev) => [...prev, text]);
  };

  const initializeWebRTC = async (token: string) => {
    try {
      // Create peer connection
      const pc = new RTCPeerConnection();
      peerConnection.current = pc;
      addDebugLog("Peer connection created");

      // Add local audio track
      addDebugLog("Getting microphone access...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });
      addDebugLog("Added local audio track");

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

      // Handle remote media stream
      pc.ontrack = (event) => {
        addDebugLog("Received remote audio track");
        const audioElement = new Audio();
        audioElement.srcObject = event.streams[0];
        audioElement.play().catch((error) => {
          addDebugLog(`Error playing audio: ${error}`);
        });
      };

      // Set up data channel
      const dc = pc.createDataChannel("oai-events");
      dataChannel.current = dc;
      addDebugLog("Data channel created");

      // Add data channel event listeners
      dc.onopen = () => {
        addDebugLog("Data channel opened");
        setIsDataChannelReady(true);
        setStatus("Ready");
        setIsConnecting(false);
      };

      dc.onclose = () => {
        addDebugLog("Data channel closed");
        setIsDataChannelReady(false);
      };

      dc.onerror = (error) => {
        const errorMsg = `Data channel error: ${error.toString()}`;
        addDebugLog(errorMsg);
        setError(errorMsg);
      };

      dc.onmessage = (event) => {
        try {
          const realtimeEvent = JSON.parse(event.data);
          addDebugLog(`Received event: ${JSON.stringify(realtimeEvent)}`);

          // Handle text delta events
          if (
            realtimeEvent.type === "response.text.delta" &&
            typeof realtimeEvent.delta === "string"
          ) {
            setMessages((prev: Message[]) => {
              const lastMessage = prev[prev.length - 1];
              if (lastMessage?.role === "assistant") {
                return [
                  ...prev.slice(0, -1),
                  {
                    ...lastMessage,
                    content: lastMessage.content + realtimeEvent.delta,
                    timestamp: lastMessage.timestamp,
                  },
                ] as Message[];
              } else {
                return [
                  ...prev,
                  {
                    role: "assistant",
                    content: realtimeEvent.delta,
                    timestamp: new Date(),
                  },
                ] as Message[];
              }
            });
          }
          // Handle audio transcript events
          else if (
            realtimeEvent.type === "response.audio_transcript.done" &&
            typeof realtimeEvent.transcript === "string"
          ) {
            addTranscript(realtimeEvent.transcript);
          }
        } catch (error) {
          addDebugLog(`Error parsing event: ${error}`);
        }
      };

      // Create and set local description
      addDebugLog("Creating offer...");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      addDebugLog("Local description set");

      // Get remote description through worker
      if (workerRef.current) {
        workerRef.current.postMessage({
          type: "GET_REMOTE_DESCRIPTION",
          data: {
            content: offer.sdp,
            token,
          },
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to initialize WebRTC";
      addDebugLog(`Error: ${errorMessage}`);
      setError(errorMessage);
      setStatus("Error");
      setIsConnecting(false);
      setIsConnected(false);
    }
  };

  // Initialize connection function
  const initializeConnection = useCallback(async () => {
    setIsConnecting(true);
    setStatus("Initializing...");
    setError(null);
    
    try {
      // Worker の初期化
      if (!workerRef.current) {
        workerRef.current = new Worker(
          new URL("../workers/webrtc.worker.ts", import.meta.url)
        );
        
        // Worker からのメッセージハンドラを設定
        workerRef.current.onmessage = async (
          event: MessageEvent<WorkerToMainMessage>
        ) => {
          const { type, data, error: workerError } = event.data;

          switch (type) {
            case "TOKEN_RECEIVED":
              if (data?.token) {
                await initializeWebRTC(data.token);
              }
              break;

            case "REMOTE_DESCRIPTION_RECEIVED":
              if (data?.sdp && peerConnection.current) {
                try {
                  const answer: RTCSessionDescriptionInit = {
                    type: "answer",
                    sdp: data.sdp,
                  };
                  await peerConnection.current.setRemoteDescription(answer);
                  addDebugLog("Remote description set");
                  setStatus("Connecting...");
                } catch (error) {
                  const errorMsg =
                    error instanceof Error
                      ? error.message
                      : "Failed to set remote description";
                  addDebugLog(`Error: ${errorMsg}`);
                  setError(errorMsg);
                  setIsConnecting(false);
                }
              }
              break;

            case "MESSAGE_FORMATTED":
              if (
                data?.userMessage &&
                data?.responseRequest &&
                dataChannel.current?.readyState === "open"
              ) {
                try {
                  addDebugLog(
                    `Sending message: ${JSON.stringify(data.userMessage)}`
                  );
                  dataChannel.current.send(JSON.stringify(data.userMessage));

                  // Wait a bit for the message to be processed
                  await new Promise((resolve) => setTimeout(resolve, 100));

                  addDebugLog(
                    `Requesting response: ${JSON.stringify(data.responseRequest)}`
                  );
                  dataChannel.current.send(JSON.stringify(data.responseRequest));
                  addDebugLog("Message and response request sent successfully");
                } catch (error) {
                  const errorMsg =
                    error instanceof Error
                      ? error.message
                      : "Failed to send message";
                  addDebugLog(`Error sending message: ${errorMsg}`);
                  setError(errorMsg);
                }
              }
              break;

            case "ERROR":
              setError(workerError || "Unknown error occurred");
              setStatus("Error");
              setIsConnecting(false);
              setIsConnected(false);
              break;

            case "DEBUG_LOG":
              if (typeof data === "string") {
                addDebugLog(data);
              }
              break;
          }
        };
      }
      
      // 接続の初期化
      workerRef.current.postMessage({ type: "INIT_CONNECTION" });
      setIsConnected(true);
    } catch (error) {
      const errorMessage = error instanceof Error 
        ? error.message 
        : "Failed to initialize connection";
      setError(errorMessage);
      setStatus("Error");
      setIsConnecting(false);
      setIsConnected(false);
    }
  }, []);

  // Disconnect function
  const disconnectConnection = useCallback(() => {
    setIsConnecting(true);
    
    try {
      // データチャネルのクローズ
      if (dataChannel.current) {
        dataChannel.current.close();
        dataChannel.current = null;
      }
      
      // ピア接続のクローズ
      if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
      }
      
      // Worker の終了
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      
      // 状態の更新
      setIsDataChannelReady(false);
      setStatus("Disconnected");
      setIsConnected(false);
      addDebugLog("Connection terminated");
    } catch (error) {
      const errorMessage = error instanceof Error 
        ? error.message 
        : "Failed to disconnect properly";
      setError(errorMessage);
      addDebugLog(`Error during disconnection: ${errorMessage}`);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  useEffect(() => {
    // クリーンアップ関数のみを返す（自動接続は行わない）
    return () => {
      // コンポーネントのアンマウント時に接続をクリーンアップ
      if (isConnected) {
        disconnectConnection();
      }
    };
  }, [disconnectConnection, isConnected]);

  const sendMessage = async () => {
    if (!inputMessage.trim()) return;

    if (!isDataChannelReady) {
      console.error("Data channel not ready");
      return;
    }

    try {
      // Add user message to UI immediately
      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: inputMessage,
          timestamp: new Date(),
        },
      ]);

      // Format message through worker
      workerRef.current?.postMessage({
        type: "FORMAT_MESSAGE",
        data: {
          content: inputMessage,
        },
      });

      setInputMessage("");
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to send message";
      console.error("Failed to send message:", err);
      setError(errorMessage);
    }
  };

  return (
    <div className="flex flex-col h-screen">
      <div className="p-4 flex-grow overflow-hidden max-w-4xl mx-auto w-full flex flex-col">
        {/* Status Section */}
        <div className="mb-4 flex-none">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">WebRTC Status</h2>
            <div className="flex gap-2">
              <button
                onClick={initializeConnection}
                disabled={isConnected || isConnecting}
                className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isConnecting ? "Connecting..." : "Connect"}
              </button>
              <button
                onClick={disconnectConnection}
                disabled={!isConnected || isConnecting}
                className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Disconnect
              </button>
            </div>
          </div>
          <p
            className={`${
              status === "Error" ? "text-red-500" : 
              status === "Disconnected" ? "text-gray-500" :
              "text-blue-500"
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
          <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-4 flex-none">
            <p className="text-red-600">{error}</p>
          </div>
        )}

        {/* Main Content Area - using CSS Grid */}
        <div className="flex-grow grid grid-cols-1 md:grid-cols-2 gap-4 min-h-0">
          {/* Left Side: Chat Messages */}
          <div className="flex flex-col min-h-0">
            <h2 className="text-xl font-semibold mb-2 flex-none">
              Chat Messages
            </h2>
            <div className="border rounded-lg p-4 bg-gray-50 flex-grow overflow-y-auto">
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
          </div>

          {/* Right Side: Voice Transcripts */}
          <div className="flex flex-col min-h-0">
            <h2 className="text-xl font-semibold mb-2 flex-none">
              Voice Transcripts
            </h2>
            <div className="border rounded-lg p-4 bg-purple-50 flex-grow overflow-y-auto">
              {transcripts.map((transcript, index) => (
                <div key={index} className="mb-2 last:mb-0">
                  <p className="text-purple-800">{transcript}</p>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          </div>
        </div>

        {/* Input Section */}
        <div className="mt-4 flex-none">
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
        </div>

        {/* Debug Log */}
        <div className="mt-4 flex-none">
          <h3 className="text-lg font-semibold mb-2">Debug Log</h3>
          <div className="bg-gray-100 p-4 rounded-md h-32 overflow-y-auto">
            {debugLog.map((log, index) => (
              <p key={index} className="text-sm font-mono mb-1">
                {log}
              </p>
            ))}
            <div ref={debugLogEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default WebRTCClient;
