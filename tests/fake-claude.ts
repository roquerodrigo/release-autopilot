export function claudeAnswer(text: string | undefined, stopReason = 'end_turn'): Response {
  return new Response(streamOf(text, stopReason), { headers: { 'content-type': 'text/event-stream' } })
}

function streamOf(text: string | undefined, stopReason: string): string {
  const events = [
    {
      message: {
        content: [],
        id: 'message',
        model: 'model',
        role: 'assistant',
        stop_reason: null,
        stop_sequence: null,
        type: 'message',
        usage: { input_tokens: 1, output_tokens: 0 },
      },
      type: 'message_start',
    },
    ...text === undefined ?
        [] :
        [
          { content_block: { text: '', type: 'text' }, index: 0, type: 'content_block_start' },
          { delta: { text, type: 'text_delta' }, index: 0, type: 'content_block_delta' },
          { index: 0, type: 'content_block_stop' },
        ],
    { delta: { stop_reason: stopReason, stop_sequence: null }, type: 'message_delta', usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ]
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
}
