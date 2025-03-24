"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkerToMainMessage } from "../workers/types";

interface Message {
  role: "assistant" | "user";
  content: string;
  timestamp: Date;
}

// Function Callingの型定義
interface FunctionCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

interface FunctionResult {
  id: string;
  name: string;
  result: any;
  error?: string;
}

// 簡易的なFunction Status表示コンポーネント
const FunctionStatus = ({ 
  activeFunctions, 
  completedFunctions 
}: { 
  activeFunctions: Map<string, { call: FunctionCall; startTime: Date }>;
  completedFunctions: FunctionResult[];
}) => {
  // 表示件数を制限（最新の3件）
  const recentCompletedFunctions = completedFunctions.slice(-3).reverse();
  
  if (activeFunctions.size === 0 && recentCompletedFunctions.length === 0) {
    return null;
  }
  
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">Function Calls</h3>
      
      {/* 現在実行中の関数 */}
      {activeFunctions.size > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium">Active:</h4>
          {Array.from(activeFunctions.entries()).map(([id, { call, startTime }]) => {
            const elapsedSeconds = Math.round((new Date().getTime() - startTime.getTime()) / 1000);
            
            return (
              <div key={id} className="text-sm p-2 bg-blue-50 border border-blue-200 rounded-md">
                <div className="flex items-center">
                  <div className="animate-pulse w-2 h-2 bg-blue-500 rounded-full mr-2"></div>
                  <div className="font-medium">{call.name}</div>
                  <div className="ml-auto text-xs text-gray-500">
                    {elapsedSeconds}s
                  </div>
                </div>
                <div className="text-xs mt-1 text-gray-700">
                  引数: {JSON.stringify(call.arguments)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      
      {/* 完了した関数の結果 */}
      {recentCompletedFunctions.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium">Recent:</h4>
          {recentCompletedFunctions.map((result, index) => (
            <div 
              key={index}
              className={`text-sm p-2 rounded-md ${
                result.error 
                  ? 'bg-red-50 border border-red-200' 
                  : 'bg-green-50 border border-green-200'
              }`}
            >
              <div className="font-medium">
                {result.name} 
                {result.error ? ' (Error)' : ' (Success)'}
              </div>
              <div className="mt-1">
                {result.error ? (
                  <span className="text-red-600">{result.error}</span>
                ) : (
                  <pre className="text-xs overflow-x-auto bg-white p-1 rounded border">
                    {JSON.stringify(result.result, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const WebRTCClient = () => {
  const workerRef = useRef<Worker>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [status, setStatus] = useState("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [isDataChannelReady, setIsDataChannelReady] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [transcripts, setTranscripts] = useState<string[]>([]);
  
  // Function Calling用の状態
  const [activeFunctions, setActiveFunctions] = useState<Map<string, { call: FunctionCall; startTime: Date }>>(new Map());
  const [completedFunctions, setCompletedFunctions] = useState<FunctionResult[]>([]);

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
        
        // データチャネルが開いたら、function callingを有効にするためにセッションを更新
        if (dc.readyState === "open") {
          try {
            // Function Call用のセッション更新イベント (修正済み)
            const sessionUpdateEvent = {
              type: "session.update",
              session: {
                tools: [
                  {
                    type: "function",
                    name: "get_weather",
                    description: "指定した場所の現在の天気情報を取得します。",
                    parameters: {
                      type: "object",
                      properties: {
                        location: {
                          type: "string",
                          description: "都市名や住所など、天気を知りたい場所",
                        },
                        units: {
                          type: "string",
                          enum: ["celsius", "fahrenheit"],
                          description: "温度の単位",
                        },
                      },
                      required: ["location"],
                    },
                  }
                ]
              }
            };
            
            addDebugLog("Sending session update with function definitions");
            dc.send(JSON.stringify(sessionUpdateEvent));
          } catch (error) {
            addDebugLog(`Error sending session update: ${error}`);
          }
        }
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

          // Function callイベントの処理
          if (realtimeEvent.type === "response.function.call") {
            addDebugLog(`Function call received: ${JSON.stringify(realtimeEvent)}`);
            
            try {
              const functionCall = {
                id: realtimeEvent.id,
                name: realtimeEvent.function.name,
                arguments: JSON.parse(realtimeEvent.function.arguments)
              };
              
              // アクティブ関数リストに追加
              setActiveFunctions(prev => {
                const newMap = new Map(prev);
                newMap.set(functionCall.id, {
                  call: functionCall,
                  startTime: new Date()
                });
                return newMap;
              });
              
              // 関数の実行（ここでは天気関数のモック実装のみ）
              executeFunction(functionCall).then(result => {
                // 完了した関数リストに追加
                setCompletedFunctions(prev => [...prev, result]);
                
                // アクティブリストから削除
                setActiveFunctions(prev => {
                  const newMap = new Map(prev);
                  newMap.delete(functionCall.id);
                  return newMap;
                });
                
                // 結果をOpenAIに返信
                if (dataChannel.current?.readyState === "open") {
                  const functionResponseEvent = {
                    type: "response.function.response",
                    function: {
                      name: result.name,
                      response: result.error ? { error: result.error } : result.result
                    },
                    id: result.id
                  };
                  
                  addDebugLog(`Sending function response: ${JSON.stringify(functionResponseEvent)}`);
                  dataChannel.current.send(JSON.stringify(functionResponseEvent));
                }
              }).catch(error => {
                addDebugLog(`Error executing function: ${error}`);
              });
            } catch (error) {
              addDebugLog(`Error processing function call: ${error}`);
            }
            
            return;
          }

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
      
      // 関数実行処理
      const executeFunction = async (functionCall: FunctionCall): Promise<FunctionResult> => {
        addDebugLog(`Executing function: ${functionCall.name}`);
        
        // 擬似的な遅延を追加
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (functionCall.name === 'get_weather') {
          const { location, units = 'celsius' } = functionCall.arguments;
          return {
            id: functionCall.id,
            name: functionCall.name,
            result: {
              location,
              temperature: units === 'celsius' ? Math.floor(Math.random() * 15) + 15 : Math.floor(Math.random() * 30) + 60,
              condition: ['晴れ', '曇り', '雨', '雪', '霧'][Math.floor(Math.random() * 5)],
              humidity: Math.floor(Math.random() * 50) + 30,
              windSpeed: Math.floor(Math.random() * 20) + 5,
              units,
              timestamp: new Date().toISOString()
            }
          };
        } else {
          return {
            id: functionCall.id,
            name: functionCall.name,
            result: null,
            error: `未実装の関数: ${functionCall.name}`
          };
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
    }
  };

  useEffect(() => {
    // Initialize worker
    workerRef.current = new Worker(
      new URL("../workers/webrtc.worker.ts", import.meta.url)
    );

    // Handle messages from worker
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
          
        case "FUNCTION_CALL":
          if (data?.functionCall) {
            addDebugLog(`Received function call from worker: ${JSON.stringify(data.functionCall)}`);
            // この部分は現在の実装では使用していません（直接データチャネルでFunctionCallを処理しているため）
          }
          break;
        
        case "SEND_TO_DATA_CHANNEL":
          if (data?.message && dataChannel.current?.readyState === "open") {
            try {
              addDebugLog(`Sending to data channel: ${JSON.stringify(data.message)}`);
              dataChannel.current.send(JSON.stringify(data.message));
            } catch (error) {
              const errorMsg =
                error instanceof Error
                  ? error.message
                  : "Failed to send message to data channel";
              addDebugLog(`Error: ${errorMsg}`);
              setError(errorMsg);
            }
          }
          break;

        case "ERROR":
          setError(workerError || "Unknown error occurred");
          setStatus("Error");
          break;

        case "DEBUG_LOG":
          if (typeof data === "string") {
            addDebugLog(data);
          }
          break;
      }
    };

    // Initialize connection
    workerRef.current.postMessage({ type: "INIT_CONNECTION" });

    // Cleanup
    return () => {
      if (dataChannel.current) {
        dataChannel.current.close();
      }
      if (peerConnection.current) {
        peerConnection.current.close();
      }
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

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
          <h2 className="text-xl font-semibold mb-2">WebRTC Status</h2>
          <p
            className={`${
              status === "Error" ? "text-red-500" : "text-blue-500"
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

        {/* Function Calling Status */}
        <div className="mt-4 flex-none">
          <FunctionStatus 
            activeFunctions={activeFunctions}
            completedFunctions={completedFunctions}
          />
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