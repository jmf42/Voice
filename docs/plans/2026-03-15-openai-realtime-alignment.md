# OpenAI Realtime Alignment

## What changed

- Kept the default realtime model on `gpt-realtime-1.5` for this codebase.
- Updated the realtime websocket session payload to use the current session shape:
  - `session.type = "realtime"`
  - `session.model`
  - `session.output_modalities = ["text"]`
  - `session.max_output_tokens`
  - `session.truncation = { type: "retention_ratio", retention_ratio: 0.8 }`
- Rewrote the live phone assistant instructions into labeled sections so the prompt matches the current OpenAI prompting guidance for realtime agents.
- Added a clarification path for obviously bad speech transcripts such as `[noise]` before intake state advances.
- Added realtime tool calling so OpenAI can now drive more of the call flow itself:
  - `lookup_business_answer`
  - `get_intake_state`
  - `check_requested_slot`
- Shifted the live call loop so, when OpenAI Realtime is configured, OpenAI now decides the next reply and uses those tools instead of relying on mostly hard-coded server replies.

## What is still missing compared with the OpenAI Realtime guides

The current product is not using OpenAI as the direct speech pipeline.

Today the path is:

1. Twilio ConversationRelay captures speech.
2. Deepgram performs speech-to-text.
3. This backend sends text turns to OpenAI Realtime.
4. The backend streams text back to Twilio.
5. Google TTS speaks the reply.

That means the product is still missing the OpenAI-native capabilities described in the official Realtime guides:

- OpenAI input audio handling
  - No `input_audio_format`
  - No OpenAI VAD settings such as `server_vad`, `semantic_vad`, or `idle_timeout_ms`
  - No OpenAI noise reduction settings
- OpenAI transcription sessions
  - No dedicated transcription-only session using `gpt-4o-transcribe` or `gpt-4o-mini-transcribe`
  - No access to OpenAI transcript metadata such as per-token log probabilities
- Full OpenAI ownership of telephony transport
  - Twilio still owns the phone-number edge and ConversationRelay transport
  - OpenAI is now the live conversation brain and tool caller, but not yet the direct SIP/WebRTC endpoint
- Complete tool surface inside the model loop
  - Business Q&A, intake-state reads, and slot checks are now OpenAI tools
  - Urgent transfer, final database writes, and closeout still stay server-controlled for safety
- Hosted prompt management
  - Prompts are still code-defined, not stored as versioned OpenAI hosted prompts

## Recommended next deeper step

If the goal is the best possible voice quality and tighter alignment with OpenAI Realtime, the next project should be a transport redesign:

- Keep Twilio only as the carrier edge for PSTN if you still need regular phone numbers, or replace it with another SIP carrier if preferred.
- Move from Twilio `ConversationRelay` text events to a direct OpenAI audio session path, ideally SIP or WebRTC depending deployment constraints.
- Let OpenAI handle turn detection, interruption timing, audio understanding, and optional transcription.
- Keep final booking writes and live transfer actions server-controlled, but expose the rest of the read/check flow to OpenAI as tools.

That is a larger architecture change, not a safe patch-level edit.
