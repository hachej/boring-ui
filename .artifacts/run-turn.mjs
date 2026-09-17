const [sessionId, requestId, ...promptParts] = process.argv.slice(2)
const prompt = promptParts.join(' ')
const base = 'http://127.0.0.1:5210/api/v1/agents/default/sessions'
const response = await fetch(`${base}/${sessionId}/prompt`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({requestId, clientNonce: requestId, content: prompt, model: {provider:'openai-codex', id:'gpt-5.6-sol'}}) })
if (![200,202].includes(response.status)) throw new Error(`${response.status}: ${await response.text()}`)
for (let i=0;i<600;i++) {
  await new Promise(r=>setTimeout(r,500))
  const stateResponse = await fetch(`${base}/${sessionId}/state`)
  const envelope = await stateResponse.json()
  if (envelope.state?.status !== 'streaming') {
    const messages = envelope.state?.messages ?? []
    const promptIndex = messages.findLastIndex(message => message.role === 'user' && message.parts?.some(part => part.type === 'text' && part.text === prompt))
    console.log(JSON.stringify({prompt, status: envelope.state?.status, error: envelope.state?.error, messages: messages.slice(Math.max(0, promptIndex))}, null, 2))
    process.exit(envelope.state?.error ? 1 : 0)
  }
}
throw new Error('turn timeout')
