# OpenAI RTC Demo

A simple demo of OpenAI's Realtime WebRTC API using Next.js and TypeScript.

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   └── session/
│   │       └── route.ts    # Session token endpoint
│   └── page.tsx           # Main WebRTC client
├── types/                 # TypeScript definitions
└── package.json
```

## Features

- Real-time text chat with OpenAI model
- Audio streaming capability
- Connection status monitoring
- Debug logging

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set up environment variables:

   ```bash
   cp .env.example .env.local
   ```

   Required variables:

   - `OPENAI_API_KEY`: Your OpenAI API key

3. Start development server:
   ```bash
   npm run dev
   ```

## Technology Stack

- Next.js 15
- TypeScript
- Tailwind CSS
- WebRTC API
- OpenAI Realtime API
